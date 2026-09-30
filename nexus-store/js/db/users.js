// Пользователи, промокоды и статистика
import { db, auth } from "../core/firebase.js";
import {
  collection, doc, query, orderBy, limit, startAfter, getDocs, updateDoc, setDoc, deleteDoc,
  onSnapshot, serverTimestamp, getCountFromServer, getAggregateFromServer, sum, where
} from "../sdk/firestore.js";
import { updateProfile, sendPasswordResetEmail } from "../sdk/auth.js";

export const usersCol = collection(db, "users");

export async function updateMyProfile(uid, data) {
  const clean = {
    name: String(data.name || "").trim().slice(0, 60),
    phone: String(data.phone || "").trim().slice(0, 30),
    city: String(data.city || "").trim().slice(0, 60),
    address: String(data.address || "").trim().slice(0, 200),
    settings: { newsletter: !!data.newsletter, theme: data.theme || "auto" },
    updatedAt: serverTimestamp()
  };
  await updateDoc(doc(db, "users", uid), clean);
  if (auth.currentUser && clean.name) await updateProfile(auth.currentUser, { displayName: clean.name });
}

export const sendReset = (email) => sendPasswordResetEmail(auth, email);

/* ---------- Админ ---------- */
export async function fetchUsers(after = null, size = 20) {
  const c = [orderBy("createdAt", "desc")];
  if (after) c.push(startAfter(after));
  c.push(limit(size));
  const snap = await getDocs(query(usersCol, ...c));
  return { items: snap.docs.map(d => ({ id: d.id, ...d.data() })), lastDoc: snap.docs[snap.docs.length - 1], hasMore: snap.docs.length === size };
}

export const setUserRole = (uid, role) => updateDoc(doc(db, "users", uid), { role });

/* ---------- Промокоды ---------- */
export function subscribePromos(cb) {
  return onSnapshot(collection(db, "promocodes"), (s) => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))));
}
export const savePromo = (code, percent, active = true) =>
  setDoc(doc(db, "promocodes", code.toUpperCase()), { percent: Number(percent), active, uses: 0, createdAt: serverTimestamp() }, { merge: true });
export const togglePromo = (code, active) => updateDoc(doc(db, "promocodes", code), { active });
export const deletePromo = (code) => deleteDoc(doc(db, "promocodes", code));

/* ---------- Статистика: агрегатные запросы count()/sum() без выкачивания документов ---------- */
export async function getStats() {
  const orders = collection(db, "orders");
  const products = collection(db, "products");
  const [u, p, o, rev, outOfStock, byStatus] = await Promise.all([
    getCountFromServer(usersCol),
    getCountFromServer(products),
    getCountFromServer(orders),
    getAggregateFromServer(query(orders, where("status", "in", ["new", "processing", "shipped", "delivered"])), { revenue: sum("total") }),
    getCountFromServer(query(products, where("stock", "==", 0))),
    Promise.all(["new", "processing", "shipped", "delivered", "cancelled"].map(async st =>
      [st, (await getCountFromServer(query(orders, where("status", "==", st)))).data().count]))
  ]);
  return {
    users: u.data().count,
    products: p.data().count,
    orders: o.data().count,
    revenue: rev.data().revenue || 0,
    outOfStock: outOfStock.data().count,
    byStatus: Object.fromEntries(byStatus)
  };
}

export async function getTopProducts(n = 5) {
  const snap = await getDocs(query(collection(db, "products"), orderBy("salesCount", "desc"), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function getLowStock(n = 6) {
  const snap = await getDocs(query(collection(db, "products"), orderBy("stock", "asc"), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function getRecentOrdersForChart(days = 14) {
  const since = new Date(Date.now() - days * 86400000);
  const snap = await getDocs(query(collection(db, "orders"), where("createdAt", ">=", since), orderBy("createdAt", "asc")));
  return snap.docs.map(d => d.data());
}
