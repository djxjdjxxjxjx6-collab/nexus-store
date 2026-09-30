// UI-утилиты: шапка, тосты, модальные окна, карточки товаров, форматирование
import { STORE_NAME, CURRENCY, categoryById, ORDER_STATUSES, CATEGORIES } from "./config.js";
import { subscribeMyOrders } from "../db/orders.js";
import { onSession, isAdmin, logout } from "./session.js";
import { db } from "./firebase.js";
import { collection, onSnapshot } from "../sdk/firestore.js";

/* ---------- Форматирование ---------- */
export const esc = (s = "") => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const money = (n = 0) => `${Math.round(Number(n) || 0).toLocaleString("ru-RU")} ${CURRENCY}`;

export function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  if (ts.seconds) return new Date(ts.seconds * 1000);
  return new Date(ts);
}
export function fmtDate(ts, withTime = true) {
  const d = toDate(ts);
  if (!d) return "только что";
  return d.toLocaleString("ru-RU", withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "long", year: "numeric" });
}
export function timeAgo(ts) {
  const d = toDate(ts);
  if (!d) return "только что";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "только что";
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} дн назад`;
  return fmtDate(ts, false);
}
export const plural = (n, [one, few, many]) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const qs = (name) => new URLSearchParams(location.search).get(name);
export const debounce = (fn, ms = 350) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- Звёзды рейтинга ---------- */
export function stars(value = 0, size = "") {
  const v = Math.round(Number(value) * 2) / 2;
  let html = "";
  for (let i = 1; i <= 5; i++) {
    const cls = v >= i ? "full" : v >= i - 0.5 ? "half" : "";
    html += `<i class="star ${cls}">★</i>`;
  }
  return `<span class="stars ${size}" aria-label="Рейтинг ${value} из 5">${html}</span>`;
}

/* ---------- Изображение товара (URL или эмодзи-заглушка) ---------- */
export function productImage(p, cls = "") {
  const cat = categoryById(p.category);
  const hue = p.hue ?? (([...(p.name || "x")].reduce((a, c) => a + c.charCodeAt(0), 0)) % 360);
  const fallback = `<div class="pimg-fallback" style="--h:${hue}"><span>${esc(p.emoji || cat.emoji)}</span></div>`;
  if (p.image) {
    return `<div class="pimg ${cls}">${fallback}<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" onerror="this.remove()"></div>`;
  }
  return `<div class="pimg ${cls}">${fallback}</div>`;
}

export function discountPct(p) {
  return p.oldPrice && p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0;
}

/* ---------- Карточка товара ---------- */
export function productCard(p, { favorite = false } = {}) {
  const pct = discountPct(p);
  const out = !p.stock || p.stock <= 0;
  const low = !out && p.stock <= 5;
  return `
  <article class="card product-card ${out ? "is-out" : ""}" data-id="${p.id}">
    <a href="product.html?id=${encodeURIComponent(p.id)}" class="product-card__media">
      ${productImage(p)}
      <div class="badges">
        ${pct ? `<span class="badge badge--sale">−${pct}%</span>` : ""}
        ${p.isNew ? `<span class="badge badge--new">NEW</span>` : ""}
        ${out ? `<span class="badge badge--muted">Нет в наличии</span>` : low ? `<span class="badge badge--warn">Осталось ${p.stock}</span>` : ""}
      </div>
    </a>
    <button class="fav-btn ${favorite ? "active" : ""}" data-fav="${p.id}" title="В избранное" aria-label="В избранное">♥</button>
    <div class="product-card__body">
      <div class="product-card__cat">${esc(categoryById(p.category).name)} · ${esc(p.brand || "")}</div>
      <a href="product.html?id=${encodeURIComponent(p.id)}" class="product-card__title">${esc(p.name)}</a>
      <div class="product-card__rating">${stars(p.ratingAvg || 0)} <span class="muted">${p.ratingCount || 0}</span></div>
      <div class="product-card__bottom">
        <div class="price">
          <span class="price__now">${money(p.price)}</span>
          ${pct ? `<span class="price__old">${money(p.oldPrice)}</span>` : ""}
        </div>
        <button class="btn btn--primary btn--icon" data-add="${p.id}" ${out ? "disabled" : ""} title="В корзину" aria-label="В корзину">🛒</button>
      </div>
    </div>
  </article>`;
}

export function skeletonCards(n = 8) {
  return Array.from({ length: n }, () => `
    <div class="card product-card skeleton">
      <div class="sk sk-img"></div>
      <div class="product-card__body"><div class="sk sk-line w60"></div><div class="sk sk-line"></div><div class="sk sk-line w40"></div></div>
    </div>`).join("");
}

export function statusBadge(status) {
  const s = ORDER_STATUSES[status] || { name: status, color: "gray" };
  return `<span class="status status--${s.color}">${esc(s.name)}</span>`;
}

export function emptyState(icon, title, text = "", action = "") {
  return `<div class="empty"><div class="empty__icon">${icon}</div><h3>${esc(title)}</h3>${text ? `<p class="muted">${esc(text)}</p>` : ""}${action}</div>`;
}

/* ---------- Тосты ---------- */
export function toast(message, type = "info", timeout = 3200) {
  let box = $("#toasts");
  if (!box) { box = document.createElement("div"); box.id = "toasts"; document.body.appendChild(box); }
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  const icon = { success: "✓", error: "✕", info: "ℹ", warn: "!" }[type] || "ℹ";
  el.innerHTML = `<span class="toast__icon">${icon}</span><span>${esc(message)}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, timeout);
}

/* ---------- Модальные окна ---------- */
export function openModal(html, { wide = false, onClose } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.innerHTML = `<div class="modal__backdrop" data-close></div>
    <div class="modal__dialog ${wide ? "modal__dialog--wide" : ""}" role="dialog" aria-modal="true">
      <button class="modal__close" data-close aria-label="Закрыть">✕</button>
      ${html}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => wrap.classList.add("show"));
  const close = () => {
    wrap.classList.remove("show");
    document.body.classList.remove("no-scroll");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => wrap.remove(), 200);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("click", (e) => { if (e.target.closest("[data-close]")) close(); });
  return { el: wrap, close };
}

export function confirmDialog(text, { okText = "Подтвердить", danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const m = openModal(`
      <h3 class="modal__title">Подтверждение</h3>
      <p>${esc(text)}</p>
      <div class="modal__actions">
        <button class="btn btn--ghost" data-no>Отмена</button>
        <button class="btn ${danger ? "btn--danger" : "btn--primary"}" data-yes>${esc(okText)}</button>
      </div>`, { onClose: () => { if (!answered) resolve(false); } });
    m.el.querySelector("[data-yes]").onclick = () => { answered = true; resolve(true); m.close(); };
    m.el.querySelector("[data-no]").onclick = () => { answered = true; resolve(false); m.close(); };
  });
}

/* ---------- Тема ---------- */
const THEME_KEY = "nexus-theme";
export function getTheme() { try { return localStorage.getItem(THEME_KEY) || "auto"; } catch { return "auto"; } }
export function applyTheme(t = getTheme()) {
  const dark = t === "dark" || (t === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
export function setTheme(t) { try { localStorage.setItem(THEME_KEY, t); } catch {} applyTheme(t); }
applyTheme();

/* ---------- Недавно просмотренные (localStorage) ---------- */
const RECENT_KEY = "nexus-recent";
export function pushRecent(p) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").filter(x => x.id !== p.id);
    list.unshift({ id: p.id, name: p.name, price: p.price, oldPrice: p.oldPrice || 0, category: p.category, emoji: p.emoji || "", image: p.image || "", brand: p.brand || "", ratingAvg: p.ratingAvg || 0, ratingCount: p.ratingCount || 0, stock: p.stock });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {}
}
export function getRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { return []; } }

/* ---------- Шапка, подвал, мобильная навигация ---------- */
let cartUnsub = null, cartUid = undefined;
let ordersUnsub = null, ordersUid = undefined;
const SEEN_KEY = "nexus-seen-status";
const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}"); } catch { return {}; } };
const writeSeen = (m) => { try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch {} };

export function mountLayout(active = "") {
  // ссылка «к содержимому» для клавиатуры и скринридеров
  const skip = document.createElement("a");
  skip.href = "#app"; skip.className = "skip-link"; skip.textContent = "Перейти к содержимому";
  document.body.prepend(skip);

  const promo = document.createElement("div");
  promo.className = "topbar";
  promo.innerHTML = `<div class="container topbar__inner"><span>🚚 Бесплатная доставка от 50 000 ₸ по Казахстану</span><span class="topbar__hide-sm">🎁 Промокод <b>WELCOME10</b> — −10% на первый заказ</span><span class="topbar__hide-sm">☎ +7 (727) 000-00-00</span></div>`;

  const header = document.createElement("header");
  header.className = "header";
  header.innerHTML = `
    <div class="container header__inner">
      <a href="index.html" class="logo" aria-label="NEXUS store — на главную"><span class="logo__mark">N</span><span class="logo__text">${STORE_NAME}<small>store</small></span></a>
      <form class="header__search" action="index.html" role="search" autocomplete="off">
        <span class="header__search-ico" aria-hidden="true">⌕</span>
        <input type="search" name="q" placeholder="Найти смартфон, ноутбук, наушники…" aria-label="Поиск товаров" aria-autocomplete="list" aria-controls="suggest">
        <kbd class="header__kbd" aria-hidden="true">/</kbd>
        <div class="suggest" id="suggest" role="listbox" hidden></div>
      </form>
      <nav class="nav" id="nav" aria-label="Основное меню">
        <a href="index.html" class="nav__link ${active === "catalog" ? "active" : ""}"><span class="nav__ico">🏬</span><span>Каталог</span></a>
        <a href="cart.html" class="nav__link ${active === "cart" ? "active" : ""}"><span class="nav__ico">🛒<b class="cart-count" id="cartCount" hidden>0</b></span><span>Корзина</span></a>
        <div class="bell" id="bellWrap" hidden>
          <button class="nav__link" id="bellBtn" aria-haspopup="true" aria-expanded="false"><span class="nav__ico">🔔<b class="cart-count" id="bellCount" hidden>0</b></span><span>Статусы</span></button>
          <div class="bell__panel card" id="bellPanel" hidden></div>
        </div>
        <a href="profile.html" class="nav__link ${active === "profile" ? "active" : ""}" id="navProfile"><span class="nav__ico">👤</span><span>Кабинет</span></a>
        <a href="admin.html" class="nav__link ${active === "admin" ? "active" : ""}" id="navAdmin" hidden><span class="nav__ico">🛠️</span><span>Админ</span></a>
        <a href="auth.html" class="nav__link" id="navLogin"><span class="nav__ico">🔑</span><span>Войти</span></a>
        <button class="nav__link nav__link--desk" id="navLogout" hidden><span class="nav__ico">🚪</span><span>Выйти</span></button>
        <button class="nav__link" id="themeToggle" title="Сменить тему" aria-label="Сменить тему"><span class="nav__ico" id="themeIco">🌙</span><span>Тема</span></button>
      </nav>
    </div>`;
  document.body.prepend(header);
  document.body.prepend(promo);
  document.body.prepend(skip);

  const q = qs("q");
  if (q) header.querySelector("input[name=q]").value = q;
  initSuggest(header.querySelector(".header__search"));

  const footer = document.createElement("footer");
  footer.className = "footer";
  footer.innerHTML = `
    <div class="container footer__features">
      <div><b>🚚</b><div><strong>Быстрая доставка</strong><span>1–3 дня по Казахстану</span></div></div>
      <div><b>🛡️</b><div><strong>Официальная гарантия</strong><span>12 месяцев на всё</span></div></div>
      <div><b>↩️</b><div><strong>Лёгкий возврат</strong><span>14 дней без вопросов</span></div></div>
      <div><b>💳</b><div><strong>Оплата при получении</strong><span>картой или наличными</span></div></div>
    </div>
    <div class="container footer__inner">
      <div><a href="index.html" class="logo"><span class="logo__mark">N</span><span class="logo__text">${STORE_NAME}<small>store</small></span></a>
      <p class="muted">Интернет-магазин электроники. Все данные — в облачной базе Firebase Firestore, обновления в реальном времени.</p></div>
      <div><h4>Каталог</h4>${CATEGORIES.slice(0, 5).map(c => `<a href="index.html?cat=${c.id}#catalog">${c.name}</a>`).join("")}</div>
      <div><h4>Покупателям</h4><a href="cart.html">Корзина</a><a href="profile.html?tab=orders">Мои заказы</a><a href="profile.html?tab=favorites">Избранное</a><a href="auth.html">Вход и регистрация</a></div>
      <div><h4>Контакты</h4><span class="muted">Алматы, пр. Абая, 1</span><span class="muted">+7 (727) 000-00-00</span><span class="muted">Ежедневно 9:00–21:00</span></div>
    </div>
    <div class="container footer__copy muted"><span>© ${new Date().getFullYear()} ${STORE_NAME} store</span><span>Vanilla JS · Firebase Auth · Cloud Firestore · GitHub Pages</span></div>`;
  document.body.appendChild(footer);

  const upd = () => { $("#themeIco").textContent = document.documentElement.dataset.theme === "dark" ? "☀️" : "🌙"; };
  upd();
  $("#themeToggle").onclick = () => { setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"); upd(); };
  $("#navLogout").onclick = () => logout();

  // «/» — фокус на поиск
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); header.querySelector("input[name=q]").focus(); }
  });

  // тень у шапки при прокрутке
  const onScroll = () => header.classList.toggle("header--scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true }); onScroll();

  initBell();

  onSession((s) => {
    const logged = !!s.user;
    $("#navLogin").hidden = logged;
    $("#navLogout").hidden = !logged;
    $("#navAdmin").hidden = !isAdmin(s);
    $("#bellWrap").hidden = !logged;
    const nameEl = $("#navProfile span:last-child");
    nameEl.textContent = logged ? (s.profile?.name || "Кабинет").split(" ")[0] : "Кабинет";

    const uid = s.user?.uid || null;
    if (uid !== cartUid) {
      cartUid = uid;
      if (cartUnsub) { cartUnsub(); cartUnsub = null; }
      const badge = $("#cartCount");
      if (logged) {
        // Счётчик корзины в реальном времени
        cartUnsub = onSnapshot(collection(db, "carts", uid, "items"), (snap) => {
          const count = snap.docs.reduce((a, d) => a + (d.data().qty || 0), 0);
          badge.textContent = count > 99 ? "99+" : count;
          badge.hidden = count === 0;
        }, () => {});
      } else badge.hidden = true;
    }
    if (uid !== ordersUid) {
      ordersUid = uid;
      if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
      if (logged) ordersUnsub = watchOrderStatuses(uid);
    }
  });
}

/* ---------- Подсказки поиска (живой поиск по Firestore) ---------- */
function initSuggest(form) {
  const input = form.querySelector("input");
  const box = form.querySelector("#suggest");
  let seq = 0, activeIdx = -1, items = [];
  const close = () => { box.hidden = true; activeIdx = -1; };
  const paint = () => {
    if (!items.length) { box.innerHTML = `<div class="suggest__empty">Ничего не найдено — нажмите Enter для полного поиска</div>`; box.hidden = false; return; }
    box.innerHTML = items.map((p, i) => `
      <a class="suggest__item ${i === activeIdx ? "active" : ""}" role="option" href="product.html?id=${encodeURIComponent(p.id)}">
        <span class="suggest__img">${esc(p.emoji || categoryById(p.category).emoji)}</span>
        <span class="suggest__name">${esc(p.name)}<small>${esc(categoryById(p.category).name)} · ${esc(p.brand || "")}</small></span>
        <b>${money(p.price)}</b>
      </a>`).join("") + `<a class="suggest__all" href="index.html?q=${encodeURIComponent(input.value.trim())}#catalog">Все результаты по «${esc(input.value.trim())}» →</a>`;
    box.hidden = false;
  };
  input.addEventListener("input", debounce(async () => {
    const text = input.value.trim();
    if (text.length < 2) return close();
    const my = ++seq;
    try {
      const { quickSearch } = await import("../db/products.js");
      const res = await quickSearch(text);
      if (my !== seq) return;
      items = res; activeIdx = -1; paint();
    } catch { close(); }
  }, 250));
  input.addEventListener("keydown", (e) => {
    if (box.hidden || !items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = (activeIdx + 1) % items.length; paint(); }
    if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = (activeIdx - 1 + items.length) % items.length; paint(); }
    if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); location.href = `product.html?id=${encodeURIComponent(items[activeIdx].id)}`; }
    if (e.key === "Escape") close();
  });
  document.addEventListener("click", (e) => { if (!form.contains(e.target)) close(); });
}

/* ---------- Уведомления о статусах заказов (onSnapshot на любой странице) ---------- */
let bellOrders = [];
function unreadOrders() {
  const seen = readSeen();
  return bellOrders.filter(o => seen[o.id] && seen[o.id] !== o.status);
}
function paintBell() {
  const n = unreadOrders().length;
  const b = $("#bellCount"); if (!b) return;
  b.textContent = n; b.hidden = !n;
  const panel = $("#bellPanel");
  const list = bellOrders.slice(0, 6);
  panel.innerHTML = `<div class="bell__head"><b>Мои заказы</b><span class="live-dot">Live</span></div>` + (list.length ? list.map(o => {
    const s = ORDER_STATUSES[o.status] || { name: o.status, color: "gray" };
    const fresh = unreadOrders().some(x => x.id === o.id);
    return `<a class="bell__item ${fresh ? "fresh" : ""}" href="profile.html?tab=orders&order=${o.id}"><span><b>${esc(o.number || "")}</b><small>${money(o.total)} · ${timeAgo(o.updatedAt || o.createdAt)}</small></span><span class="status status--${s.color}">${esc(s.name)}</span></a>`;
  }).join("") : `<div class="suggest__empty">Заказов пока нет</div>`);
}
function initBell() {
  const btn = $("#bellBtn"), panel = $("#bellPanel");
  btn.onclick = (e) => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open; btn.setAttribute("aria-expanded", String(open));
    if (open) {
      paintBell();
      // отмечаем как прочитанные
      const seen = readSeen(); bellOrders.forEach(o => seen[o.id] = o.status); writeSeen(seen);
      setTimeout(paintBell, 1500);
    }
  };
  document.addEventListener("click", (e) => { if (!$("#bellWrap").contains(e.target)) panel.hidden = true; });
}
function watchOrderStatuses(uid) {
  return subscribeMyOrders(uid, (list) => {
    const seen = readSeen();
    list.forEach(o => {
      if (!seen[o.id]) seen[o.id] = o.status;                     // новый заказ — считаем увиденным
      const old = bellOrders.find(x => x.id === o.id);
      if (old && old.status !== o.status && !location.pathname.endsWith("profile.html")) {
        toast(`Заказ ${o.number}: ${ORDER_STATUSES[o.status]?.name || o.status}`, "info", 5000);
      }
    });
    writeSeen(seen);
    bellOrders = list;
    paintBell();
  }, () => {});
}

/* ---------- PWA и глобальная обработка ошибок ---------- */
if ("serviceWorker" in navigator && location.protocol === "https:") {
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  if (e.reason?.code) toast(humanError(e.reason), "error");
});
addEventListener("offline", () => toast("Нет интернета — показываем сохранённые данные", "warn", 5000));
addEventListener("online", () => toast("Соединение восстановлено", "success"));

/* ---------- Ошибки Firebase на русском ---------- */
export function humanError(e) {
  const code = e?.code || "";
  const map = {
    "auth/invalid-email": "Некорректный e-mail",
    "auth/user-not-found": "Пользователь не найден",
    "auth/wrong-password": "Неверный пароль",
    "auth/invalid-credential": "Неверный e-mail или пароль",
    "auth/invalid-login-credentials": "Неверный e-mail или пароль",
    "auth/email-already-in-use": "Этот e-mail уже зарегистрирован",
    "auth/weak-password": "Слишком простой пароль (минимум 6 символов)",
    "auth/too-many-requests": "Слишком много попыток. Попробуйте позже",
    "auth/network-request-failed": "Нет соединения с сетью",
    "auth/requires-recent-login": "Для этого действия войдите заново",
    "permission-denied": "Недостаточно прав для этого действия",
    "unavailable": "Сервер недоступен, проверьте интернет",
    "failed-precondition": "Индекс базы данных ещё создаётся, попробуйте через минуту"
  };
  return map[code] || e?.message || "Что-то пошло не так";
}
