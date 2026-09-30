// Отзывы: reviews/{productId}_{uid} — один отзыв на товар от пользователя.
// Рейтинг товара (ratingSum/ratingCount/ratingAvg) денормализован в products и пересчитывается транзакцией.
import { db } from "../core/firebase.js";
import {
  collection, doc, query, where, orderBy, limit, startAfter, getDocs, onSnapshot,
  runTransaction, serverTimestamp
} from "../sdk/firestore.js";

export const reviewsCol = collection(db, "reviews");
const mapDoc = (d) => ({ id: d.id, ...d.data() });

export const reviewId = (productId, uid) => `${productId}_${uid}`;

/** Сохранить (создать/изменить) отзыв и пересчитать рейтинг товара. */
export async function saveReview({ product, user, profile, rating, text }) {
  rating = Math.min(5, Math.max(1, parseInt(rating, 10)));
  const rRef = doc(db, "reviews", reviewId(product.id, user.uid));
  const pRef = doc(db, "products", product.id);
  await runTransaction(db, async (tx) => {
    const [pSnap, rSnap] = await Promise.all([tx.get(pRef), tx.get(rRef)]);
    if (!pSnap.exists()) throw new Error("Товар не найден");
    const p = pSnap.data();
    let sum = p.ratingSum || 0, count = p.ratingCount || 0;
    if (rSnap.exists()) sum += rating - (rSnap.data().rating || 0);
    else { sum += rating; count += 1; }
    tx.update(pRef, { ratingSum: sum, ratingCount: count, ratingAvg: count ? Math.round(sum / count * 10) / 10 : 0 });
    tx.set(rRef, {
      productId: product.id,
      productName: p.name,                 // денормализация для личного кабинета
      userId: user.uid,
      userName: profile?.name || user.email.split("@")[0],
      rating,
      text: String(text || "").trim().slice(0, 2000),
      createdAt: rSnap.exists() ? rSnap.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
      edited: rSnap.exists()
    });
  });
}

/** Удалить отзыв (автор или админ-модератор) с пересчётом рейтинга. */
export async function deleteReview(review) {
  const rRef = doc(db, "reviews", review.id);
  const pRef = doc(db, "products", review.productId);
  await runTransaction(db, async (tx) => {
    const [pSnap, rSnap] = await Promise.all([tx.get(pRef), tx.get(rRef)]);
    if (!rSnap.exists()) return;
    if (pSnap.exists()) {
      const p = pSnap.data();
      const sum = Math.max(0, (p.ratingSum || 0) - (rSnap.data().rating || 0));
      const count = Math.max(0, (p.ratingCount || 0) - 1);
      tx.update(pRef, { ratingSum: sum, ratingCount: count, ratingAvg: count ? Math.round(sum / count * 10) / 10 : 0 });
    }
    tx.delete(rRef);
  });
}

function withFallback(qMain, qFallback, cb, onError, size) {
  let inner = null;
  const unsub = onSnapshot(qMain, (s) => cb(s.docs.map(mapDoc), s), (err) => {
    if (err.code === "failed-precondition") {
      inner = onSnapshot(qFallback, (s) => {
        const list = s.docs.map(mapDoc).sort((a, b) => (b.createdAt?.seconds || 9e9) - (a.createdAt?.seconds || 9e9));
        cb(list.slice(0, size), s);
      }, onError);
    } else onError && onError(err);
  });
  return () => { unsub(); inner && inner(); };
}

/** Отзывы о товаре: первая порция в реальном времени. */
export function subscribeProductReviews(productId, size, cb, onError) {
  return withFallback(
    query(reviewsCol, where("productId", "==", productId), orderBy("createdAt", "desc"), limit(size)),
    query(reviewsCol, where("productId", "==", productId), limit(100)),
    cb, onError, size);
}

export async function fetchMoreReviews(productId, afterDoc, size) {
  const snap = await getDocs(query(reviewsCol, where("productId", "==", productId), orderBy("createdAt", "desc"), startAfter(afterDoc), limit(size)));
  return { items: snap.docs.map(mapDoc), lastDoc: snap.docs[snap.docs.length - 1], hasMore: snap.docs.length === size };
}

export function subscribeMyReviews(uid, cb, onError) {
  return withFallback(
    query(reviewsCol, where("userId", "==", uid), orderBy("createdAt", "desc"), limit(50)),
    query(reviewsCol, where("userId", "==", uid), limit(50)),
    cb, onError, 50);
}

export function subscribeLatestReviews(size, cb, onError) {
  return onSnapshot(query(reviewsCol, orderBy("createdAt", "desc"), limit(size)), (s) => cb(s.docs.map(mapDoc)), onError);
}
