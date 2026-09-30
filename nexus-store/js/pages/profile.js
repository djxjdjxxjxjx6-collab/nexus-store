// Личный кабинет: история заказов (real-time), отзывы, избранное, профиль, безопасность
import {
  mountLayout, $, $$, esc, money, fmtDate, timeAgo, statusBadge, productImage, productCard, stars,
  emptyState, toast, humanError, confirmDialog, openModal, qs, setTheme, plural
} from "../core/ui.js";
import { requireAuth, onSession, getSession, isAdmin, logout } from "../core/session.js";
import { subscribeMyOrders, cancelMyOrder } from "../db/orders.js";
import { subscribeMyReviews, saveReview, deleteReview } from "../db/reviews.js";
import { updateMyProfile, sendReset } from "../db/users.js";
import { addToCart } from "../db/cart.js";
import { getProductsByIds } from "../db/products.js";
import { bindProductGrid, onFavorites, paintFavs } from "../core/actions.js";
import { ORDER_STATUSES, STATUS_FLOW } from "../core/config.js";

mountLayout("profile");
const s = await requireAuth();
const uid = s.user.uid;
const app = $("#app");

const TABS = [
  ["overview", "🏠", "Обзор"], ["orders", "📦", "Мои заказы"], ["reviews", "💬", "Мои отзывы"],
  ["favorites", "♥", "Избранное"], ["settings", "⚙️", "Профиль"], ["security", "🔒", "Безопасность"]
];
let tab = qs("tab") || "overview";
let orders = [], reviews = [], favorites = [];
let orderFilter = "";
let openedFromUrl = false;

app.innerHTML = `
  <div class="page-head"><div><h1>Личный кабинет</h1><p class="muted" id="hello"></p></div></div>
  <div class="cabinet">
    <aside class="card side-menu">
      <div class="side-menu__user"><div class="avatar" id="avatar"></div><div><b id="uName"></b><div class="small muted" id="uEmail"></div></div></div>
      ${TABS.map(([id, ico, name]) => `<button class="side-link" data-tab="${id}">${ico} ${name}<span class="count" id="cnt-${id}" hidden></span></button>`).join("")}
      <button class="side-link" id="logoutBtn">🚪 Выйти</button>
    </aside>
    <section id="tabRoot"></section>
  </div>`;

$$(".side-link[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, "", `?tab=${tab}`); render(); });
$("#logoutBtn").onclick = () => logout();

onSession((st) => {
  if (!st.profile) return;
  $("#uName").textContent = st.profile.name;
  $("#uEmail").textContent = st.profile.email;
  $("#avatar").textContent = (st.profile.name || "?")[0].toUpperCase();
  $("#hello").innerHTML = `Здравствуйте, <b>${esc(st.profile.name)}</b>! ${isAdmin(st) ? `<a href="admin.html" class="badge badge--new">admin</a>` : ""}`;
  if (tab === "overview") render();
});

// Real-time подписки
subscribeMyOrders(uid, (list) => {
  const prev = orders;
  orders = list;
  // уведомление о смене статуса админом
  list.forEach(o => {
    const old = prev.find(x => x.id === o.id);
    if (old && old.status !== o.status) toast(`Заказ ${o.number}: ${ORDER_STATUSES[o.status]?.name}`, "info", 5000);
  });
  setCount("orders", list.filter(o => !["delivered", "cancelled"].includes(o.status)).length);
  if (["orders", "overview"].includes(tab)) render();
  const oid = qs("order");
  if (oid && !openedFromUrl) { const o = list.find(x => x.id === oid); if (o) { openedFromUrl = true; showOrder(o); } }
}, (e) => console.error(e));

subscribeMyReviews(uid, (list) => { reviews = list; setCount("reviews", list.length); if (tab === "reviews") render(); }, (e) => console.error(e));
onFavorites((list) => { favorites = list; setCount("favorites", list.length); if (tab === "favorites") render(); });

function setCount(t, n) { const el = $(`#cnt-${t}`); el.textContent = n; el.hidden = !n; }

function render() {
  $$(".side-link[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const root = $("#tabRoot");
  ({ overview, orders: ordersTab, reviews: reviewsTab, favorites: favoritesTab, settings, security }[tab] || overview)(root);
}

/* ---------- Обзор ---------- */
function overview(root) {
  const p = getSession().profile || {};
  const active = orders.filter(o => !["delivered", "cancelled"].includes(o.status));
  root.innerHTML = `
    <div class="stat-cards">
      <div class="card stat"><span class="stat__icon">📦</span><div class="stat__label">Всего заказов</div><div class="stat__value">${p.ordersCount || 0}</div></div>
      <div class="card stat"><span class="stat__icon">💰</span><div class="stat__label">Сумма покупок</div><div class="stat__value">${money(p.totalSpent || 0)}</div></div>
      <div class="card stat"><span class="stat__icon">💬</span><div class="stat__label">Отзывов</div><div class="stat__value">${reviews.length}</div></div>
      <div class="card stat"><span class="stat__icon">♥</span><div class="stat__label">В избранном</div><div class="stat__value">${favorites.length}</div></div>
    </div>
    <div class="section-title" style="margin-top:10px"><h2>Активные заказы <span class="live-dot">Live</span></h2></div>
    ${active.length ? active.map(orderCard).join("") : `<div class="card panel">${emptyState("📭", "Нет активных заказов", "", `<a class="btn btn--primary" href="index.html">За покупками</a>`)}</div>`}`;
  bindOrders(root);
}

/* ---------- Заказы ---------- */
function orderCard(o) {
  const step = ORDER_STATUSES[o.status]?.step ?? 0;
  return `<div class="card order" data-oid="${o.id}">
    <div class="order__head">
      <b>Заказ ${esc(o.number || o.id.slice(0, 6))}</b> ${statusBadge(o.status)}
      <span class="small muted">${fmtDate(o.createdAt)}</span>
      <div class="spacer"></div><b>${money(o.total)}</b>
    </div>
    <div class="order__items">${o.items.slice(0, 6).map(i => `<div class="order__thumb" title="${esc(i.name)}">${productImage(i)}<b>×${i.qty}</b></div>`).join("")}${o.items.length > 6 ? `<span class="muted">+${o.items.length - 6}</span>` : ""}</div>
    ${o.status !== "cancelled" ? `<div class="timeline">${STATUS_FLOW.map((st, idx) => `<div class="timeline__step ${idx <= step ? "done" : ""}">${ORDER_STATUSES[st].name}</div>`).join("")}</div>` : ""}
    <div class="row" style="margin-top:10px">
      <button class="btn btn--sm btn--ghost" data-details>Подробнее</button>
      <button class="btn btn--sm btn--ghost" data-repeat>🔁 Повторить</button>
      ${o.status === "new" ? `<button class="btn btn--sm btn--ghost" data-cancel style="color:var(--red)">Отменить</button>` : ""}
    </div>
  </div>`;
}

function ordersTab(root) {
  const list = orderFilter ? orders.filter(o => o.status === orderFilter) : orders;
  root.innerHTML = `
    <div class="filter-pills">
      <button class="pill ${!orderFilter ? "active" : ""}" data-f="">Все (${orders.length})</button>
      ${Object.entries(ORDER_STATUSES).map(([k, v]) => { const n = orders.filter(o => o.status === k).length; return n ? `<button class="pill ${orderFilter === k ? "active" : ""}" data-f="${k}">${v.name} (${n})</button>` : ""; }).join("")}
      <div class="spacer"></div><span class="live-dot">Статусы обновляются в реальном времени</span>
    </div>
    ${list.length ? list.map(orderCard).join("") : `<div class="card panel">${emptyState("📦", "Заказов пока нет", "История покупок появится здесь", `<a class="btn btn--primary" href="index.html">Перейти в каталог</a>`)}</div>`}`;
  $$(".pill", root).forEach(p => p.onclick = () => { orderFilter = p.dataset.f; render(); });
  bindOrders(root);
}

function bindOrders(root) {
  $$("[data-oid]", root).forEach(el => {
    const o = orders.find(x => x.id === el.dataset.oid);
    el.querySelector("[data-details]").onclick = () => showOrder(o);
    el.querySelector("[data-repeat]").onclick = () => repeatOrder(o);
    const c = el.querySelector("[data-cancel]");
    if (c) c.onclick = async () => {
      if (!await confirmDialog(`Отменить заказ ${o.number}?`, { okText: "Отменить заказ", danger: true })) return;
      try { await cancelMyOrder(o); toast("Заказ отменён", "success"); } catch (e) { toast(humanError(e), "error"); }
    };
  });
}

function showOrder(o) {
  const d = o.delivery || {};
  openModal(`
    <h3 class="modal__title">Заказ ${esc(o.number)} ${statusBadge(o.status)}</h3>
    <p class="small muted">Оформлен ${fmtDate(o.createdAt)}</p>
    <table class="table">${o.items.map(i => `<tr><td style="width:56px">${productImage(i)}</td><td><a href="product.html?id=${i.productId}">${esc(i.name)}</a><div class="small muted">${money(i.price)} × ${i.qty}</div></td><td style="text-align:right"><b>${money(i.price * i.qty)}</b></td></tr>`).join("")}</table>
    <div class="summary__row"><span class="muted">Товары</span><span>${money(o.subtotal)}</span></div>
    ${o.discount ? `<div class="summary__row" style="color:var(--green)"><span>Скидка ${esc(o.promoCode || "")}</span><span>−${money(o.discount)}</span></div>` : ""}
    <div class="summary__row"><span class="muted">Доставка</span><span>${o.deliveryPrice ? money(o.deliveryPrice) : "Бесплатно"}</span></div>
    <div class="summary__row summary__total"><span>Итого</span><span>${money(o.total)}</span></div>
    <h4 style="margin-top:18px">Доставка</h4>
    <p class="small">${esc(d.name)} · ${esc(d.phone)}<br>${d.method === "pickup" ? "Самовывоз" : "Курьер"}: ${esc(d.city)}, ${esc(d.address)}<br>Оплата: ${d.payment === "cash" ? "наличными" : "картой"}${d.comment ? `<br>Комментарий: ${esc(d.comment)}` : ""}</p>
    <h4>История статусов</h4>
    ${(o.statusHistory || []).map(h => `<div class="row small" style="margin:4px 0">${statusBadge(h.status)} <span class="muted">${fmtDate(h.at)}</span></div>`).join("")}
  `, { wide: true });
}

async function repeatOrder(o) {
  try {
    const prods = await getProductsByIds(o.items.map(i => i.productId));
    let added = 0;
    for (const i of o.items) {
      const p = prods.find(x => x.id === i.productId);
      if (!p || !p.stock) continue;
      try { await addToCart(uid, p, Math.min(i.qty, p.stock)); added++; } catch {}
    }
    if (added) { toast(`Добавлено в корзину: ${added} ${plural(added, ["позиция", "позиции", "позиций"])}`, "success"); setTimeout(() => location.href = "cart.html", 700); }
    else toast("Товаров из заказа нет в наличии", "warn");
  } catch (e) { toast(humanError(e), "error"); }
}

/* ---------- Отзывы ---------- */
function reviewsTab(root) {
  root.innerHTML = `<div class="card panel">
    <h3>Мои отзывы</h3>
    ${reviews.length ? reviews.map(r => `
      <div class="review" data-rid="${r.id}">
        <div class="review__head"><div><a href="product.html?id=${r.productId}"><b>${esc(r.productName)}</b></a><div class="small muted">${timeAgo(r.createdAt)}${r.edited ? " · изменён" : ""}</div></div><div class="spacer"></div>${stars(r.rating)}</div>
        <div data-text>${esc(r.text) || `<span class="muted">Без комментария</span>`}</div>
        <div class="row" style="margin-top:8px"><button class="link-btn" data-edit>✎ Редактировать</button><button class="link-btn" data-del>🗑 Удалить</button></div>
      </div>`).join("") : emptyState("💬", "Вы ещё не оставляли отзывов", "Поделитесь мнением о купленных товарах")}
  </div>`;
  $$("[data-rid]", root).forEach(el => {
    const r = reviews.find(x => x.id === el.dataset.rid);
    el.querySelector("[data-del]").onclick = async () => {
      if (!await confirmDialog("Удалить отзыв?", { okText: "Удалить", danger: true })) return;
      try { await deleteReview(r); toast("Отзыв удалён", "success"); } catch (e) { toast(humanError(e), "error"); }
    };
    el.querySelector("[data-edit]").onclick = () => {
      const m = openModal(`
        <h3 class="modal__title">Редактировать отзыв</h3><p class="muted">${esc(r.productName)}</p>
        <form id="editReview">
          <div class="star-input">${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="e${n}" value="${n}" ${r.rating === n ? "checked" : ""}><label for="e${n}">★</label>`).join("")}</div>
          <div class="field"><textarea class="input" name="text" maxlength="2000">${esc(r.text)}</textarea></div>
          <div class="modal__actions"><button type="button" class="btn btn--ghost" data-close>Отмена</button><button class="btn btn--primary">Сохранить</button></div>
        </form>`);
      m.el.querySelector("#editReview").onsubmit = async (e) => {
        e.preventDefault();
        try {
          const st = getSession();
          await saveReview({ product: { id: r.productId }, user: st.user, profile: st.profile, rating: e.target.rating.value, text: e.target.text.value });
          toast("Отзыв обновлён", "success"); m.close();
        } catch (err) { toast(humanError(err), "error"); }
      };
    };
  });
}

/* ---------- Избранное ---------- */
function favoritesTab(root) {
  root.innerHTML = favorites.length
    ? `<div class="grid" id="favGrid">${favorites.map(f => productCard({ ...f, id: f.id })).join("")}</div>`
    : `<div class="card panel">${emptyState("♥", "В избранном пусто", "Нажимайте ♥ на карточках товаров, чтобы сохранить их", `<a class="btn btn--primary" href="index.html">В каталог</a>`)}</div>`;
  const g = $("#favGrid");
  if (g) { bindProductGrid(g, (id) => { const f = favorites.find(x => x.id === id); return f && { ...f, id }; }); paintFavs(g); }
}

/* ---------- Профиль ---------- */
function settings(root) {
  const p = getSession().profile || {};
  root.innerHTML = `<form class="card panel" id="profileForm">
    <h3>Личные данные</h3>
    <div class="grid-2">
      <div class="field"><label>Имя</label><input class="input" name="name" required maxlength="60" value="${esc(p.name || "")}"></div>
      <div class="field"><label>E-mail</label><input class="input" value="${esc(p.email || "")}" disabled></div>
      <div class="field"><label>Телефон</label><input class="input" name="phone" type="tel" value="${esc(p.phone || "")}" placeholder="+7 7__ ___ __ __"></div>
      <div class="field"><label>Город</label><input class="input" name="city" value="${esc(p.city || "")}"></div>
    </div>
    <div class="field"><label>Адрес доставки по умолчанию</label><input class="input" name="address" value="${esc(p.address || "")}"></div>
    <h3>Настройки</h3>
    <label class="check" style="margin-bottom:12px"><input type="checkbox" name="newsletter" ${p.settings?.newsletter ? "checked" : ""}> Получать новости и скидки на e-mail</label>
    <div class="field" style="max-width:260px"><label>Тема оформления</label>
      <select class="input" name="theme">${[["auto", "Как в системе"], ["light", "Светлая"], ["dark", "Тёмная"]].map(([v, n]) => `<option value="${v}" ${(p.settings?.theme || "auto") === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="row"><button class="btn btn--primary">Сохранить</button><span class="small muted">Роль: <b>${esc(p.role || "user")}</b> · с нами с ${fmtDate(p.createdAt, false)}</span></div>
  </form>`;
  $("#profileForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button");
    btn.classList.add("loading");
    try {
      await updateMyProfile(uid, { name: f.name.value, phone: f.phone.value, city: f.city.value, address: f.address.value, newsletter: f.newsletter.checked, theme: f.theme.value });
      setTheme(f.theme.value);
      toast("Профиль сохранён", "success");
    } catch (err) { toast(humanError(err), "error"); }
    btn.classList.remove("loading");
  };
}

/* ---------- Безопасность ---------- */
function security(root) {
  const u = getSession().user;
  root.innerHTML = `<div class="card panel">
    <h3>Безопасность</h3>
    <p>E-mail: <b>${esc(u.email)}</b> ${u.emailVerified ? `<span class="status status--green">подтверждён</span>` : ""}</p>
    <p class="muted">Последний вход: ${u.metadata?.lastSignInTime ? new Date(u.metadata.lastSignInTime).toLocaleString("ru-RU") : "—"}</p>
    <div class="row"><button class="btn btn--ghost" id="resetBtn">📧 Сменить пароль через e-mail</button><button class="btn btn--danger" id="outBtn">Выйти из аккаунта</button></div>
  </div>`;
  $("#resetBtn").onclick = async () => {
    try { await sendReset(u.email); toast("Письмо для смены пароля отправлено", "success"); } catch (e) { toast(humanError(e), "error"); }
  };
  $("#outBtn").onclick = () => logout();
}

render();
