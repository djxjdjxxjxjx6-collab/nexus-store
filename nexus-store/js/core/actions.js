// Общие действия с товарами: в корзину / в избранное (делегирование событий на сетках)
import { getSession, onSession } from "./session.js";
import { addToCart, toggleFavorite, subscribeFavorites } from "../db/cart.js";
import { toast, humanError, $$ } from "./ui.js";

let favIds = new Set();
const favListeners = new Set();
let favUnsub = null;

let favUid = null;
onSession((s) => {
  const uid = s.user?.uid || null;
  if (uid === favUid) return;           // профиль обновился, пользователь тот же
  favUid = uid;
  favUnsub && favUnsub();
  favIds = new Set();
  if (uid) favUnsub = subscribeFavorites(uid, (list) => {
    favIds = new Set(list.map(f => f.id));
    paintFavs();
    favListeners.forEach(cb => cb(list));
  });
  else paintFavs();
});

export const isFav = (id) => favIds.has(id);
export const onFavorites = (cb) => { favListeners.add(cb); return () => favListeners.delete(cb); };

export function paintFavs(root = document) {
  $$("[data-fav]", root).forEach(b => b.classList.toggle("active", favIds.has(b.dataset.fav)));
}

function needLogin() {
  toast("Войдите, чтобы продолжить", "warn");
  setTimeout(() => location.href = `auth.html?next=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}`, 900);
}

export async function addProductToCart(product, qty = 1, btn = null) {
  const s = getSession();
  if (!s.user) return needLogin();
  try {
    btn && btn.classList.add("loading");
    await addToCart(s.user.uid, product, qty);
    toast(`«${product.name}» в корзине`, "success");
  } catch (e) {
    toast(e.code === "stock" ? e.message : humanError(e), "error");
  } finally { btn && btn.classList.remove("loading"); }
}

export async function toggleProductFav(product) {
  const s = getSession();
  if (!s.user) return needLogin();
  const was = favIds.has(product.id);
  try {
    await toggleFavorite(s.user.uid, product, was);
    toast(was ? "Удалено из избранного" : "Добавлено в избранное", was ? "info" : "success");
  } catch (e) { toast(humanError(e), "error"); }
}

/** Навешивает обработчики на контейнер с карточками. getProduct(id) → объект товара */
export function bindProductGrid(container, getProduct) {
  container.addEventListener("click", (e) => {
    const add = e.target.closest("[data-add]");
    const fav = e.target.closest("[data-fav]");
    if (add) { e.preventDefault(); const p = getProduct(add.dataset.add); p && addProductToCart(p, 1, add); }
    if (fav) { e.preventDefault(); const p = getProduct(fav.dataset.fav); p && toggleProductFav(p); }
  });
}
