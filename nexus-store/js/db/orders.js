// Заказы: оформление (транзакция), история пользователя, управление статусами
import { db } from "../core/firebase.js";
import {
  collection, doc, query, where, orderBy, limit, startAfter, getDocs, onSnapshot,
  runTransaction, serverTimestamp, increment, updateDoc, arrayUnion, Timestamp, writeBatch, getDoc
} from "../sdk/firestore.js";
import { DELIVERY_PRICE, FREE_DELIVERY_FROM } from "../core/config.js";

export const ordersCol = collection(db, "orders");

export function calcTotals(items, promo = null) {
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const discount = promo ? Math.round(subtotal * promo.percent / 100) : 0;
  const deliveryPrice = subtotal - discount >= FREE_DELIVERY_FROM || subtotal === 0 ? 0 : DELIVERY_PRICE;
  return { subtotal, discount, deliveryPrice, total: subtotal - discount + deliveryPrice };
}

/** Проверка промокода promocodes/{CODE} */
export async function checkPromo(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!c) return null;
  const s = await getDoc(doc(db, "promocodes", c));
  if (!s.exists() || !s.data().active) return null;
  return { code: c, ...s.data() };
}

/**
 * Оформление заказа одной транзакцией:
 * проверка остатков → списание stock → создание заказа → обновление счётчиков пользователя → очистка корзины.
 * Корзина (активные действия) переносится в историю (orders).
 */
export async function placeOrder({ user, profile, items, promo, delivery }) {
  if (!items.length) throw new Error("Корзина пуста");
  return runTransaction(db, async (tx) => {
    const refs = items.map(i => doc(db, "products", i.productId));
    const snaps = await Promise.all(refs.map(r => tx.get(r)));
    let promoSnap = null;
    if (promo) {
      promoSnap = await tx.get(doc(db, "promocodes", promo.code));
      if (!promoSnap.exists() || !promoSnap.data().active) throw new Error("Промокод больше не действует");
    }

    const orderItems = items.map((i, idx) => {
      const s = snaps[idx];
      if (!s.exists()) throw new Error(`Товар «${i.name}» больше не продаётся`);
      const p = s.data();
      if ((p.stock || 0) < i.qty) throw new Error(`«${p.name}»: в наличии только ${p.stock} шт.`);
      return {
        productId: s.id, name: p.name, price: p.price, qty: i.qty,
        image: p.image || "", emoji: p.emoji || "", category: p.category
      };
    });

    const totals = calcTotals(orderItems, promo);
    const orderRef = doc(ordersCol);
    const now = Timestamp.now();

    snaps.forEach((s, idx) => {
      tx.update(refs[idx], { stock: increment(-orderItems[idx].qty), salesCount: increment(orderItems[idx].qty) });
    });
    if (promoSnap) tx.update(promoSnap.ref, { uses: increment(1) });

    tx.set(orderRef, {
      number: `NX-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      userId: user.uid,
      userName: profile?.name || user.email,   // дублирование для админки без лишних чтений users
      userEmail: user.email,
      items: orderItems,
      itemsCount: orderItems.reduce((a, i) => a + i.qty, 0),
      ...totals,
      promoCode: promo?.code || null,
      delivery: {
        name: delivery.name, phone: delivery.phone, city: delivery.city,
        address: delivery.address, method: delivery.method, payment: delivery.payment, comment: delivery.comment || ""
      },
      status: "new",
      statusHistory: [{ status: "new", at: now }],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    tx.update(doc(db, "users", user.uid), {
      ordersCount: increment(1),
      totalSpent: increment(totals.total),
      lastOrderAt: serverTimestamp()
    });

    items.forEach(i => tx.delete(doc(db, "carts", user.uid, "items", i.id)));
    return orderRef.id;
  });
}

/** История заказов пользователя — в реальном времени (статусы меняет админ). */
export function subscribeMyOrders(uid, cb, onError) {
  const q = query(ordersCol, where("userId", "==", uid), orderBy("createdAt", "desc"), limit(50));
  let inner = null;
  const unsub = onSnapshot(q, (snap) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (err) => {
    if (err.code === "failed-precondition") {
      // индекс ещё строится — сортируем на клиенте
      inner = onSnapshot(query(ordersCol, where("userId", "==", uid), limit(50)), (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt?.seconds || 9e9) - (a.createdAt?.seconds || 9e9));
        cb(list);
      }, onError);
    } else onError && onError(err);
  });
  return () => { unsub(); inner && inner(); };
}

export function subscribeOrder(id, cb) {
  return onSnapshot(doc(db, "orders", id), (s) => cb(s.exists() ? { id: s.id, ...s.data() } : null));
}

/** Пользователь может отменить только новый заказ. */
export async function cancelMyOrder(order) {
  await updateDoc(doc(db, "orders", order.id), {
    status: "cancelled",
    statusHistory: arrayUnion({ status: "cancelled", at: Timestamp.now(), by: "user" }),
    updatedAt: serverTimestamp()
  });
}

/* ---------- Админ ---------- */
export function subscribeAllOrders(status, size, cb, onError) {
  const c = [];
  if (status) c.push(where("status", "==", status));
  c.push(orderBy("createdAt", "desc"), limit(size));
  let inner = null;
  const unsub = onSnapshot(query(ordersCol, ...c), (snap) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), (err) => {
    if (err.code === "failed-precondition" && status) {
      inner = onSnapshot(query(ordersCol, where("status", "==", status), limit(size)), (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.createdAt?.seconds || 9e9) - (a.createdAt?.seconds || 9e9));
        cb(list);
      }, onError);
    } else onError && onError(err);
  });
  return () => { unsub(); inner && inner(); };
}

/** Смена статуса админом. При отмене — возврат товара на склад. */
export async function setOrderStatus(order, status) {
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", order.id), {
    status,
    statusHistory: arrayUnion({ status, at: Timestamp.now(), by: "admin" }),
    updatedAt: serverTimestamp()
  });
  if (status === "cancelled" && order.status !== "cancelled") {
    const exists = await Promise.all(order.items.map(i => getDoc(doc(db, "products", i.productId))));
    order.items.forEach((i, idx) => {
      if (exists[idx].exists()) batch.update(exists[idx].ref, { stock: increment(i.qty), salesCount: increment(-i.qty) });
    });
  }
  await batch.commit();
}

export { startAfter };
