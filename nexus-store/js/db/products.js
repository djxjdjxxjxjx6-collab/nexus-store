// Работа с коллекцией products (+ подколлекция details для тяжёлых данных)
import { db } from "../core/firebase.js";
import {
  collection, doc, query, where, orderBy, limit, startAfter, getDocs, getDoc,
  onSnapshot, writeBatch, serverTimestamp, getCountFromServer, deleteDoc
} from "../sdk/firestore.js";
import { PAGE_SIZE, SORTS } from "../core/config.js";

export const productsCol = collection(db, "products");
const SEARCH_LIMIT = 60;

/** Поисковые ключи: все префиксы слов (от 2 символов) из названия, бренда, категории и тегов. */
export function buildKeywords(...parts) {
  const words = parts.flat().filter(Boolean).join(" ").toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/).filter(w => w.length >= 2);
  const set = new Set();
  for (const w of words) {
    for (let i = 2; i <= Math.min(w.length, 15); i++) set.add(w.slice(0, i));
  }
  return [...set].slice(0, 200);
}

export function normalizeSearch(q = "") {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/[\s-]+/).filter(w => w.length >= 2);
}

const mapDoc = (d) => ({ id: d.id, ...d.data() });

/**
 * Строит запрос каталога.
 * Фильтры по равенству (category, onSale) + сортировка → составные индексы из firestore.indexes.json.
 * При поиске используется array-contains по searchKeywords (индекс по одному полю, без orderBy),
 * а сортировка результатов выполняется на клиенте — это экономит десятки составных индексов.
 */
function buildQuery({ category, onSale, search, sort }, after = null, size = PAGE_SIZE, forceClient = false) {
  const c = [];
  if (category) c.push(where("category", "==", category));
  if (onSale) c.push(where("onSale", "==", true));
  const terms = normalizeSearch(search);
  if (terms.length) {
    // берём самое длинное слово — оно самое селективное
    const term = [...terms].sort((a, b) => b.length - a.length)[0].slice(0, 15);
    if (forceClient) c.length = 0; // без индекса: только поиск на сервере, фильтры на клиенте
    c.push(where("searchKeywords", "array-contains", term));
    c.push(limit(SEARCH_LIMIT));
    return { q: query(productsCol, ...c), clientSide: true, terms };
  }
  if (forceClient) {
    // Резерв: если составной индекс ещё не построен — фильтр на сервере, сортировка на клиенте
    c.push(limit(100));
    return { q: query(productsCol, ...c), clientSide: true, terms };
  }
  const s = SORTS.find(x => x.id === sort) || SORTS[0];
  c.push(orderBy(s.field, s.dir));
  if (after) c.push(startAfter(after));
  c.push(limit(size));
  return { q: query(productsCol, ...c), clientSide: false, terms };
}

function clientProcess(items, { category, onSale, sort }, terms) {
  const s = SORTS.find(x => x.id === sort) || SORTS[0];
  let res = items.filter(p =>
    (!category || p.category === category) &&
    (!onSale || p.onSale) &&
    terms.every(t => (p.searchKeywords || []).some(k => k.startsWith(t.slice(0, 15))) ||
      (p.name || "").toLowerCase().includes(t)));
  const val = (p) => s.field === "createdAt" ? (p.createdAt?.seconds || 0) : (p[s.field] || 0);
  res.sort((a, b) => s.dir === "asc" ? val(a) - val(b) : val(b) - val(a));
  return res;
}

/**
 * Первая страница каталога в режиме реального времени (onSnapshot).
 * cb({ items, lastDoc, hasMore, changes })
 */
export function subscribeCatalog(opts, cb, onError, forceClient = false) {
  const { q, clientSide, terms } = buildQuery(opts, null, PAGE_SIZE, forceClient);
  let first = true;
  let inner = null;
  const unsub = onSnapshot(q, (snap) => {
    let items = snap.docs.map(mapDoc);
    const changes = first ? [] : snap.docChanges().filter(ch => ch.type === "added" && !ch.doc.metadata.hasPendingWrites).map(ch => mapDoc(ch.doc));
    first = false;
    if (clientSide) items = clientProcess(items, opts, terms);
    cb({
      items,
      lastDoc: clientSide ? null : snap.docs[snap.docs.length - 1] || null,
      hasMore: !clientSide && snap.docs.length === PAGE_SIZE,
      clientSide,
      changes,
      fromCache: snap.metadata.fromCache
    });
  }, (err) => {
    if (err.code === "failed-precondition" && !forceClient) {
      console.warn("Нужен составной индекс, используется резервный запрос:", err.message);
      inner = subscribeCatalog(opts, cb, onError, true);
    } else onError && onError(err);
  });
  return () => { unsub(); inner && inner(); };
}

/** Следующая страница (курсорная пагинация startAfter). */
export async function fetchCatalogPage(opts, lastDoc) {
  const { q } = buildQuery(opts, lastDoc);
  const snap = await getDocs(q);
  return {
    items: snap.docs.map(mapDoc),
    lastDoc: snap.docs[snap.docs.length - 1] || null,
    hasMore: snap.docs.length === PAGE_SIZE
  };
}

/** Количество товаров по фильтру — агрегатный запрос count(), без загрузки документов. */
export async function countCatalog({ category, onSale }) {
  const c = [];
  if (category) c.push(where("category", "==", category));
  if (onSale) c.push(where("onSale", "==", true));
  const snap = await getCountFromServer(query(productsCol, ...c));
  return snap.data().count;
}

export async function getProduct(id) {
  const s = await getDoc(doc(db, "products", id));
  return s.exists() ? mapDoc(s) : null;
}

/** Real-time подписка на товар: цена, наличие, рейтинг обновляются без перезагрузки. */
export function subscribeProduct(id, cb, onError) {
  return onSnapshot(doc(db, "products", id), (s) => cb(s.exists() ? mapDoc(s) : null), onError);
}

/** Тяжёлые данные (описание, характеристики) хранятся отдельно и грузятся только на странице товара. */
export async function getDetails(id) {
  const s = await getDoc(doc(db, "products", id, "details", "main"));
  return s.exists() ? s.data() : { description: "", specs: {} };
}

/** Похожие товары той же категории с пагинацией. */
export async function fetchSimilar(category, excludeId, after = null, size = 4) {
  const c = [where("category", "==", category), orderBy("ratingAvg", "desc")];
  if (after) c.push(startAfter(after));
  c.push(limit(size + 1));
  let snap;
  try {
    snap = await getDocs(query(productsCol, ...c));
  } catch (e) {
    if (e.code !== "failed-precondition") throw e;
    // резервный вариант, пока строится индекс
    snap = await getDocs(query(productsCol, where("category", "==", category), limit(24)));
  }
  const docs = snap.docs.filter(d => d.id !== excludeId);
  const page = docs.slice(0, size);
  return { items: page.map(mapDoc), lastDoc: page[page.length - 1] || null, hasMore: snap.docs.length > size };
}

export async function getProductsByIds(ids) {
  const res = await Promise.all(ids.map(id => getDoc(doc(db, "products", id))));
  return res.filter(s => s.exists()).map(mapDoc);
}

/* ---------- Админ: CRUD ---------- */
export function productPayload(data) {
  const price = Number(data.price) || 0;
  const oldPrice = Number(data.oldPrice) || 0;
  const tags = (Array.isArray(data.tags) ? data.tags : String(data.tags || "").split(","))
    .map(t => t.trim().toLowerCase()).filter(Boolean);
  return {
    name: String(data.name).trim(),
    nameLower: String(data.name).trim().toLowerCase(),
    brand: String(data.brand || "").trim(),
    category: data.category,
    price,
    oldPrice: oldPrice > price ? oldPrice : 0,
    onSale: oldPrice > price,
    stock: Math.max(0, parseInt(data.stock, 10) || 0),
    image: String(data.image || "").trim(),
    emoji: String(data.emoji || "").trim(),
    shortDesc: String(data.shortDesc || "").trim().slice(0, 200),
    tags,
    isNew: !!data.isNew,
    searchKeywords: buildKeywords(data.name, data.brand, tags)
  };
}

export async function saveProduct(data, id = null) {
  const batch = writeBatch(db);
  const ref = id ? doc(db, "products", id) : doc(productsCol);
  const base = productPayload(data);
  if (id) {
    batch.update(ref, { ...base, updatedAt: serverTimestamp() });
  } else {
    batch.set(ref, {
      ...base, ratingAvg: 0, ratingCount: 0, ratingSum: 0, salesCount: 0,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    });
  }
  batch.set(doc(db, "products", ref.id, "details", "main"), {
    description: String(data.description || ""),
    specs: data.specs || {}
  }, { merge: false });
  await batch.commit();
  return ref.id;
}

export async function deleteProduct(id) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "products", id, "details", "main"));
  batch.delete(doc(db, "products", id));
  await batch.commit();
}

export { deleteDoc };
