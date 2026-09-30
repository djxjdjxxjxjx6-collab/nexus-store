// Активные действия: корзина carts/{uid}/items/{productId} и избранное users/{uid}/favorites/{productId}
import { db } from "../core/firebase.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, increment,
  serverTimestamp, getDoc, writeBatch, getDocs, query, orderBy
} from "../sdk/firestore.js";

const itemsCol = (uid) => collection(db, "carts", uid, "items");

/** Дублируем в корзину название/цену/картинку, чтобы не читать products при каждом открытии корзины. */
function snapshotOf(p) {
  return {
    productId: p.id, name: p.name, price: p.price, oldPrice: p.oldPrice || 0,
    image: p.image || "", emoji: p.emoji || "", category: p.category, brand: p.brand || ""
  };
}

export async function addToCart(uid, product, qty = 1) {
  const ref = doc(db, "carts", uid, "items", product.id);
  const cur = await getDoc(ref);
  const have = cur.exists() ? cur.data().qty || 0 : 0;
  if (have + qty > (product.stock ?? 0)) {
    throw Object.assign(new Error(`Доступно только ${product.stock} шт.`), { code: "stock" });
  }
  await setDoc(ref, {
    ...snapshotOf(product),
    qty: increment(qty),
    updatedAt: serverTimestamp(),
    ...(cur.exists() ? {} : { addedAt: serverTimestamp() })
  }, { merge: true });
}

export const setQty = (uid, productId, qty) =>
  updateDoc(doc(db, "carts", uid, "items", productId), { qty, updatedAt: serverTimestamp() });

export const removeFromCart = (uid, productId) => deleteDoc(doc(db, "carts", uid, "items", productId));

export async function clearCart(uid) {
  const snap = await getDocs(itemsCol(uid));
  const b = writeBatch(db);
  snap.docs.forEach(d => b.delete(d.ref));
  await b.commit();
}

export function subscribeCart(uid, cb, onError) {
  return onSnapshot(query(itemsCol(uid), orderBy("addedAt", "asc")), (snap) =>
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), onError);
}

/* ---------- Избранное ---------- */
const favCol = (uid) => collection(db, "users", uid, "favorites");

export function subscribeFavorites(uid, cb) {
  return onSnapshot(favCol(uid), (snap) => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => cb([]));
}

export async function toggleFavorite(uid, product, isFav) {
  const ref = doc(db, "users", uid, "favorites", product.id);
  if (isFav) await deleteDoc(ref);
  else await setDoc(ref, { ...snapshotOf(product), ratingAvg: product.ratingAvg || 0, ratingCount: product.ratingCount || 0, stock: product.stock ?? 0, addedAt: serverTimestamp() });
}
