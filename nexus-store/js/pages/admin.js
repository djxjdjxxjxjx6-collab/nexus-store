// Админ-панель: статистика, CRUD товаров, заказы (real-time), пользователи и роли, модерация, промокоды
import {
  mountLayout, $, $$, esc, money, fmtDate, timeAgo, statusBadge, productImage, stars, productCard,
  emptyState, toast, humanError, confirmDialog, openModal, debounce, plural
} from "../core/ui.js";
import { requireAuth, isAdmin, getSession, onSession } from "../core/session.js";
import { CATEGORIES, categoryById, ORDER_STATUSES } from "../core/config.js";
import { db } from "../core/firebase.js";
import { collection, query, orderBy, limit, startAfter, getDocs, where } from "../sdk/firestore.js";
import { saveProduct, deleteProduct, getDetails, normalizeSearch } from "../db/products.js";
import { subscribeAllOrders, setOrderStatus } from "../db/orders.js";
import { subscribeLatestReviews, deleteReview } from "../db/reviews.js";
import { fetchUsers, setUserRole, getStats, getTopProducts, getLowStock, getRecentOrdersForChart, subscribePromos, savePromo, togglePromo, deletePromo } from "../db/users.js";
import { seedDemo } from "../db/seed.js";

mountLayout("admin");
const s = await requireAuth();
const app = $("#app");

// Ждём профиль, чтобы проверить роль
await new Promise(r => { onSession(st => { if (st.profile || !st.user) r(); }); setTimeout(r, 5000); });
if (!isAdmin(getSession())) {
  app.innerHTML = emptyState("⛔", "Доступ запрещён", "Эта страница доступна только администраторам", `<a class="btn btn--primary" href="index.html">На главную</a>`);
  throw new Error("not admin");
}

const TABS = [["dash", "📊", "Дашборд"], ["products", "📦", "Товары"], ["orders", "🧾", "Заказы"], ["users", "👥", "Пользователи"], ["reviews", "💬", "Модерация"], ["promos", "🏷️", "Промокоды"]];
let tab = new URLSearchParams(location.search).get("tab") || "dash";
const unsubs = [];
const cleanup = () => { while (unsubs.length) try { unsubs.pop()(); } catch {} };

app.innerHTML = `
  <div class="page-head"><div><h1>Админ-панель</h1><p class="muted">Управление магазином · <span class="live-dot">Live</span></p></div></div>
  <div class="cabinet">
    <aside class="card side-menu">${TABS.map(([id, ico, n]) => `<button class="side-link" data-tab="${id}">${ico} ${n}<span class="count" id="cnt-${id}" hidden></span></button>`).join("")}</aside>
    <section id="root"></section>
  </div>`;
$$(".side-link").forEach(b => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, "", `?tab=${tab}`); render(); });

// Счётчик новых заказов в меню (real-time)
subscribeAllOrders("new", 99, (list) => { const el = $("#cnt-orders"); el.textContent = list.length; el.hidden = !list.length; }, () => {});

function render() {
  cleanup();
  $$(".side-link").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const root = $("#root");
  root.innerHTML = `<div class="sk" style="height:300px;border-radius:16px"></div>`;
  ({ dash, products, orders, users, reviews, promos }[tab] || dash)(root);
}

/* ================= Дашборд ================= */
async function dash(root) {
  try {
    const [st, top, low, recent] = await Promise.all([getStats(), getTopProducts(5), getLowStock(6), getRecentOrdersForChart(14).catch(() => [])]);
    const days = [...Array(14)].map((_, i) => { const d = new Date(Date.now() - (13 - i) * 86400000); return { key: d.toDateString(), label: d.getDate(), sum: 0, n: 0 }; });
    recent.forEach(o => { const d = o.createdAt?.toDate?.(); const day = d && days.find(x => x.key === d.toDateString()); if (day && o.status !== "cancelled") { day.sum += o.total; day.n++; } });
    const max = Math.max(1, ...days.map(d => d.sum));
    const totalByStatus = Object.values(st.byStatus).reduce((a, b) => a + (b || 0), 0) || 1;
    const avg = st.orders ? st.revenue / Math.max(1, st.orders - (st.byStatus.cancelled || 0)) : 0;
    root.innerHTML = `
      <div class="stat-cards">
        <div class="card stat"><span class="stat__icon">💰</span><div class="stat__label">Выручка</div><div class="stat__value">${money(st.revenue)}</div></div>
        <div class="card stat"><span class="stat__icon">🧾</span><div class="stat__label">Заказов</div><div class="stat__value">${st.orders ?? "—"}</div></div>
        <div class="card stat"><span class="stat__icon">📈</span><div class="stat__label">Средний чек</div><div class="stat__value">${money(avg)}</div></div>
        <div class="card stat"><span class="stat__icon">👥</span><div class="stat__label">Пользователей</div><div class="stat__value">${st.users ?? "—"}</div></div>
        <div class="card stat"><span class="stat__icon">📦</span><div class="stat__label">Товаров</div><div class="stat__value">${st.products ?? "—"}</div></div>
        <div class="card stat"><span class="stat__icon">⚠️</span><div class="stat__label">Нет в наличии</div><div class="stat__value">${st.outOfStock ?? "—"}</div></div>
      </div>
      ${st.products === 0 ? `<div class="notice">Каталог пуст. <button class="btn btn--primary btn--sm" id="seedBtn">Заполнить демо-товарами (40 шт.)</button></div>` : ""}
      <div class="admin-grid">
        <div class="card panel"><h3>Выручка за 14 дней</h3>
          <div class="bars">${days.map(d => `<div style="height:${d.sum / max * 100}%" data-tip="${d.label}: ${money(d.sum)} · ${d.n} зак."></div>`).join("")}</div>
          <div class="bar-labels">${days.map(d => `<span>${d.label}</span>`).join("")}</div></div>
        <div class="card panel"><h3>Заказы по статусам</h3>
          ${Object.entries(ORDER_STATUSES).map(([k, v]) => `<div class="hbar"><span>${v.name}</span><div class="hbar__track"><div style="width:${(st.byStatus[k] || 0) / totalByStatus * 100}%;background:var(--${v.color})"></div></div><b>${st.byStatus[k] || 0}</b></div>`).join("")}</div>
        <div class="card panel"><h3>🔥 Топ продаж</h3>
          <table class="table">${top.map(p => `<tr><td style="width:56px">${productImage(p)}</td><td><a href="product.html?id=${p.id}">${esc(p.name)}</a></td><td><b>${p.salesCount || 0}</b> шт.</td></tr>`).join("")}</table></div>
        <div class="card panel"><h3>📉 Заканчиваются</h3>
          <table class="table">${low.map(p => `<tr><td><a href="product.html?id=${p.id}">${esc(p.name)}</a></td><td><span class="status status--${p.stock ? "amber" : "red"}">${p.stock} шт.</span></td></tr>`).join("")}</table></div>
      </div>
      <p class="small muted">Метрики считаются агрегатными запросами Firestore count()/sum() без загрузки документов.</p>`;
    const sb = $("#seedBtn"); if (sb) sb.onclick = doSeed;
  } catch (e) { root.innerHTML = emptyState("⚠️", "Ошибка загрузки статистики", humanError(e)); console.error(e); }
}

async function doSeed(e) {
  e.currentTarget.classList.add("loading");
  try { const n = await seedDemo(getSession().user); toast(`Добавлено ${n} товаров и 2 промокода`, "success"); render(); }
  catch (err) { toast(humanError(err), "error"); }
}

/* ================= Товары (CRUD) ================= */
function products(root) {
  let items = [], last = null, hasMore = false, filterCat = "", search = "";
  root.innerHTML = `
    <div class="card panel">
      <div class="row" style="margin-bottom:14px">
        <h3 style="margin:0">Товары</h3><div class="spacer"></div>
        <input class="input" id="pSearch" placeholder="Поиск по названию" style="max-width:220px">
        <select class="input" id="pCat" style="width:auto"><option value="">Все категории</option>${CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
        <button class="btn btn--ghost" id="seedBtn2">🌱 Демо-данные</button>
        <button class="btn btn--primary" id="addP">+ Добавить товар</button>
      </div>
      <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Название</th><th>Категория</th><th>Цена</th><th>Склад</th><th>Рейтинг</th><th>Продано</th><th></th></tr></thead><tbody id="pBody"></tbody></table></div>
      <div class="load-more"><button class="btn btn--ghost" id="pMore" hidden>Показать ещё</button></div>
    </div>`;

  const load = async (reset = false) => {
    if (reset) { items = []; last = null; }
    const c = [];
    const terms = normalizeSearch(search);
    if (filterCat) c.push(where("category", "==", filterCat));
    if (terms.length) c.push(where("searchKeywords", "array-contains", terms[0]));
    else c.push(orderBy("createdAt", "desc"));
    if (last) c.push(startAfter(last));
    c.push(limit(20));
    try {
      let snap;
      try { snap = await getDocs(query(collection(db, "products"), ...c)); }
      catch (e) { if (e.code !== "failed-precondition") throw e; snap = await getDocs(query(collection(db, "products"), ...c.filter(x => x.type !== "orderBy"))); }
      items.push(...snap.docs.map(d => ({ id: d.id, ...d.data() })));
      last = snap.docs[snap.docs.length - 1]; hasMore = snap.docs.length === 20;
      paint();
    } catch (e) { toast(humanError(e), "error"); }
  };
  const paint = () => {
    $("#pBody").innerHTML = items.length ? items.map(p => `
      <tr data-id="${p.id}">
        <td>${productImage(p)}</td>
        <td><a href="product.html?id=${p.id}" target="_blank"><b>${esc(p.name)}</b></a><div class="small muted">${esc(p.brand)}</div></td>
        <td>${categoryById(p.category).emoji} ${esc(categoryById(p.category).name)}</td>
        <td><b>${money(p.price)}</b>${p.oldPrice ? `<div class="small muted" style="text-decoration:line-through">${money(p.oldPrice)}</div>` : ""}</td>
        <td><span class="status status--${!p.stock ? "red" : p.stock <= 5 ? "amber" : "green"}">${p.stock}</span></td>
        <td>${(p.ratingAvg || 0).toFixed(1)} ★ <span class="small muted">(${p.ratingCount || 0})</span></td>
        <td>${p.salesCount || 0}</td>
        <td style="white-space:nowrap"><button class="btn btn--sm btn--ghost" data-edit title="Редактировать">✎</button> <button class="btn btn--sm btn--ghost" data-copy title="Дублировать">⧉</button> <button class="btn btn--sm btn--ghost" data-del style="color:var(--red)">🗑</button></td>
      </tr>`).join("") : `<tr><td colspan="8">${emptyState("📦", "Товаров нет", "Добавьте первый товар или загрузите демо-данные")}</td></tr>`;
    $("#pMore").hidden = !hasMore;
  };
  $("#pMore").onclick = () => load();
  $("#pCat").onchange = (e) => { filterCat = e.target.value; load(true); };
  $("#pSearch").oninput = debounce((e) => { search = e.target.value; load(true); });
  $("#addP").onclick = () => productForm(null, () => load(true));
  $("#seedBtn2").onclick = async (e) => {
    if (!await confirmDialog("Добавить 40 демонстрационных товаров?")) return;
    await doSeed({ currentTarget: e.target }); load(true);
  };
  $("#pBody").onclick = async (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr) return;
    const p = items.find(x => x.id === tr.dataset.id);
    if (e.target.closest("[data-edit]")) productForm(p, () => load(true));
    if (e.target.closest("[data-copy]")) productForm({ ...p, id: null, name: p.name + " (копия)", __details: await getDetails(p.id) }, () => load(true));
    if (e.target.closest("[data-del]")) {
      if (!await confirmDialog(`Удалить «${p.name}»? Это действие необратимо.`, { okText: "Удалить", danger: true })) return;
      try { await deleteProduct(p.id); items = items.filter(x => x.id !== p.id); paint(); toast("Товар удалён", "success"); }
      catch (err) { toast(humanError(err), "error"); }
    }
  };
  load(true);
}

async function productForm(p, onSaved) {
  const d = p?.id ? await getDetails(p.id) : (p?.__details || { description: "", specs: {} });
  const specsText = Object.entries(d.specs || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  const m = openModal(`
    <h3 class="modal__title">${p?.id ? "Редактировать товар" : "Новый товар"}</h3>
    <div class="form-preview" id="pPreview"></div>
    <form id="pForm">
      <div class="grid-2">
        <div class="field"><label>Название *</label><input class="input" name="name" required maxlength="120" value="${esc(p?.name || "")}"></div>
        <div class="field"><label>Бренд</label><input class="input" name="brand" value="${esc(p?.brand || "")}"></div>
        <div class="field"><label>Категория *</label><select class="input" name="category" required>${CATEGORIES.map(c => `<option value="${c.id}" ${p?.category === c.id ? "selected" : ""}>${c.emoji} ${c.name}</option>`).join("")}</select></div>
        <div class="field"><label>Эмодзи (если нет фото)</label><input class="input" name="emoji" maxlength="4" value="${esc(p?.emoji || "")}"></div>
        <div class="field"><label>Цена, ₸ *</label><input class="input" name="price" type="number" min="0" required value="${p?.price ?? ""}"></div>
        <div class="field"><label>Старая цена (для скидки)</label><input class="input" name="oldPrice" type="number" min="0" value="${p?.oldPrice || ""}"></div>
        <div class="field"><label>Остаток на складе *</label><input class="input" name="stock" type="number" min="0" required value="${p?.stock ?? 10}"></div>
        <div class="field"><label>Теги (через запятую)</label><input class="input" name="tags" value="${esc((p?.tags || []).join(", "))}"></div>
      </div>
      <div class="field"><label>URL изображения</label><input class="input" name="image" type="url" placeholder="https://…" value="${esc(p?.image || "")}"></div>
      <div class="field"><label>Краткое описание (для карточки)</label><input class="input" name="shortDesc" maxlength="200" value="${esc(p?.shortDesc || "")}"></div>
      <div class="field"><label>Полное описание</label><textarea class="input" name="description" rows="4">${esc(d.description || "")}</textarea></div>
      <div class="field"><label>Характеристики (каждая с новой строки: «Ключ: значение»)</label><textarea class="input" name="specs" rows="4">${esc(specsText)}</textarea></div>
      <label class="check"><input type="checkbox" name="isNew" ${p?.isNew ? "checked" : ""}> Пометить как «NEW»</label>
      <div class="modal__actions"><button type="button" class="btn btn--ghost" data-close>Отмена</button><button class="btn btn--primary">${p?.id ? "Сохранить" : "Создать"}</button></div>
    </form>`, { wide: true });
  // живой предпросмотр карточки
  const pf = m.el.querySelector("#pForm");
  const preview = () => {
    const v = Object.fromEntries(new FormData(pf));
    m.el.querySelector("#pPreview").innerHTML = productCard({ id: "preview", name: v.name || "Название товара", brand: v.brand, category: v.category,
      emoji: v.emoji, image: v.image, price: Number(v.price) || 0, oldPrice: Number(v.oldPrice) || 0, stock: Number(v.stock) || 0,
      ratingAvg: p?.ratingAvg || 0, ratingCount: p?.ratingCount || 0, isNew: !!v.isNew });
  };
  pf.addEventListener("input", preview); preview();
  m.el.querySelector("#pForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector("button:not([data-close])");
    const specs = {};
    f.specs.value.split("\n").forEach(line => { const i = line.indexOf(":"); if (i > 0) specs[line.slice(0, i).trim()] = line.slice(i + 1).trim(); });
    btn.classList.add("loading");
    try {
      await saveProduct({
        name: f.name.value, brand: f.brand.value, category: f.category.value, emoji: f.emoji.value,
        price: f.price.value, oldPrice: f.oldPrice.value, stock: f.stock.value, tags: f.tags.value,
        image: f.image.value, shortDesc: f.shortDesc.value, description: f.description.value, specs, isNew: f.isNew.checked
      }, p?.id || null);
      toast(p?.id ? "Товар обновлён" : "Товар создан — он уже появился в каталоге у всех покупателей", "success");
      m.close(); onSaved && onSaved();
    } catch (err) { toast(humanError(err), "error"); btn.classList.remove("loading"); }
  };
}

/* ================= Заказы (real-time) ================= */
function orders(root) {
  let status = "", size = 30, list = [];
  root.innerHTML = `
    <div class="card panel">
      <div class="row" style="margin-bottom:14px"><h3 style="margin:0">Все заказы</h3><span class="live-dot">Live</span><div class="spacer"></div>
        <button class="btn btn--ghost btn--sm" id="csv">⬇ Экспорт CSV</button></div>
      <div class="filter-pills"><button class="pill active" data-f="">Все</button>${Object.entries(ORDER_STATUSES).map(([k, v]) => `<button class="pill" data-f="${k}">${v.name}</button>`).join("")}
        <div class="spacer"></div><input class="input" id="oSearch" placeholder="№ заказа, имя или e-mail" style="max-width:240px"></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>№</th><th>Дата</th><th>Покупатель</th><th>Товары</th><th>Сумма</th><th>Статус</th><th></th></tr></thead><tbody id="oBody"></tbody></table></div>
      <div class="load-more"><button class="btn btn--ghost" id="oMore" hidden>Показать ещё</button></div>
    </div>`;
  const sub = () => {
    cleanup();
    unsubs.push(subscribeAllOrders(status, size, (l) => {
      const fresh = list.length && l.filter(o => !list.some(x => x.id === o.id) && o.status === "new");
      if (fresh && fresh.length) toast(`Новый заказ ${fresh[0].number} на ${money(fresh[0].total)}`, "success", 5000);
      list = l; paint();
    }, (e) => toast(humanError(e), "error")));
  };
  let term = "";
  const paint = () => {
    const shown = term ? list.filter(o => [o.number, o.userName, o.userEmail, o.delivery?.phone].join(" ").toLowerCase().includes(term)) : list;
    $("#oBody").innerHTML = shown.length ? shown.map(o => `
      <tr data-id="${o.id}">
        <td><b>${esc(o.number || o.id.slice(0, 6))}</b></td>
        <td class="small">${fmtDate(o.createdAt)}</td>
        <td>${esc(o.userName)}<div class="small muted">${esc(o.userEmail)}</div></td>
        <td class="small">${o.itemsCount || o.items.length} ${plural(o.itemsCount || o.items.length, ["шт.", "шт.", "шт."])}</td>
        <td><b>${money(o.total)}</b></td>
        <td><select class="input" data-status>${Object.entries(ORDER_STATUSES).map(([k, v]) => `<option value="${k}" ${o.status === k ? "selected" : ""}>${v.name}</option>`).join("")}</select></td>
        <td><button class="btn btn--sm btn--ghost" data-view>👁</button></td>
      </tr>`).join("") : `<tr><td colspan="7">${emptyState("🧾", "Заказов нет")}</td></tr>`;
    $("#oMore").hidden = list.length < size;
  };
  $$(".pill", root).forEach(p => p.onclick = () => { $$(".pill", root).forEach(x => x.classList.toggle("active", x === p)); status = p.dataset.f; list = []; sub(); });
  $("#oMore").onclick = () => { size += 30; sub(); };
  $("#oSearch").oninput = debounce((e) => { term = e.target.value.trim().toLowerCase(); paint(); }, 200);
  $("#oBody").onchange = async (e) => {
    const sel = e.target.closest("[data-status]"); if (!sel) return;
    const o = list.find(x => x.id === sel.closest("tr").dataset.id);
    const newStatus = sel.value;
    if (newStatus === "cancelled" && !await confirmDialog("Отменить заказ? Товары вернутся на склад.", { okText: "Отменить заказ", danger: true })) { sel.value = o.status; return; }
    try { await setOrderStatus(o, newStatus); toast(`Статус: ${ORDER_STATUSES[newStatus].name}. Покупатель увидит его сразу`, "success"); }
    catch (err) { toast(humanError(err), "error"); sel.value = o.status; }
  };
  $("#oBody").onclick = (e) => {
    if (!e.target.closest("[data-view]")) return;
    const o = list.find(x => x.id === e.target.closest("tr").dataset.id);
    const d = o.delivery || {};
    openModal(`<h3 class="modal__title">Заказ ${esc(o.number)} ${statusBadge(o.status)}</h3>
      <p class="small muted">${fmtDate(o.createdAt)} · ${esc(o.userName)} (${esc(o.userEmail)})</p>
      <table class="table">${o.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty} × ${money(i.price)}</td><td><b>${money(i.qty * i.price)}</b></td></tr>`).join("")}</table>
      <div class="summary__row"><span>Скидка ${esc(o.promoCode || "")}</span><span>−${money(o.discount || 0)}</span></div>
      <div class="summary__row"><span>Доставка</span><span>${money(o.deliveryPrice || 0)}</span></div>
      <div class="summary__row summary__total"><span>Итого</span><span>${money(o.total)}</span></div>
      <p class="small">${esc(d.name)} · ${esc(d.phone)}<br>${d.method === "pickup" ? "Самовывоз" : "Курьер"}: ${esc(d.city)}, ${esc(d.address)}<br>Оплата: ${d.payment === "cash" ? "наличными" : "картой"}${d.comment ? `<br>💬 ${esc(d.comment)}` : ""}</p>
      <h4>История</h4>${(o.statusHistory || []).map(h => `<div class="row small">${statusBadge(h.status)} <span class="muted">${fmtDate(h.at)} · ${h.by || "система"}</span></div>`).join("")}`, { wide: true });
  };
  $("#csv").onclick = () => {
    const rows = [["Номер", "Дата", "Покупатель", "Email", "Телефон", "Город", "Товаров", "Сумма", "Статус"]]
      .concat(list.map(o => [o.number, fmtDate(o.createdAt), o.userName, o.userEmail, o.delivery?.phone, o.delivery?.city, o.itemsCount, o.total, ORDER_STATUSES[o.status]?.name]));
    const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };
  sub();
}

/* ================= Пользователи и роли ================= */
function users(root) {
  let items = [], last = null;
  root.innerHTML = `<div class="card panel">
    <h3>Пользователи</h3>
    <div class="table-wrap"><table class="table"><thead><tr><th>Пользователь</th><th>Регистрация</th><th>Заказов</th><th>Потрачено</th><th>Роль</th></tr></thead><tbody id="uBody"></tbody></table></div>
    <div class="load-more"><button class="btn btn--ghost" id="uMore" hidden>Показать ещё</button></div></div>`;
  const me = getSession().user.uid;
  const load = async () => {
    try {
      const res = await fetchUsers(last, 20);
      items.push(...res.items); last = res.lastDoc;
      $("#uBody").innerHTML = items.map(u => `<tr data-id="${u.id}">
        <td class="row" style="flex-wrap:nowrap"><div class="avatar">${esc((u.name || "?")[0].toUpperCase())}</div><div><b>${esc(u.name)}</b>${u.id === me ? ` <span class="badge badge--new">вы</span>` : ""}<div class="small muted">${esc(u.email)}</div></div></td>
        <td class="small">${fmtDate(u.createdAt, false)}</td>
        <td>${u.ordersCount || 0}</td><td>${money(u.totalSpent || 0)}</td>
        <td><select class="input" data-role ${u.id === me ? "disabled" : ""}><option value="user" ${u.role !== "admin" ? "selected" : ""}>user</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option></select></td>
      </tr>`).join("");
      $("#uMore").hidden = !res.hasMore;
    } catch (e) { toast(humanError(e), "error"); }
  };
  $("#uMore").onclick = load;
  $("#uBody").onchange = async (e) => {
    const sel = e.target.closest("[data-role]"); if (!sel) return;
    const u = items.find(x => x.id === sel.closest("tr").dataset.id);
    if (!await confirmDialog(`Назначить ${u.name} роль «${sel.value}»?`)) { sel.value = u.role; return; }
    try { await setUserRole(u.id, sel.value); u.role = sel.value; toast("Права доступа обновлены", "success"); }
    catch (err) { toast(humanError(err), "error"); sel.value = u.role; }
  };
  load();
}

/* ================= Модерация отзывов ================= */
function reviews(root) {
  let size = 20;
  root.innerHTML = `<div class="card panel"><div class="row"><h3 style="margin:0">Последние отзывы</h3><span class="live-dot">Live</span></div><div id="rList"></div>
    <div class="load-more"><button class="btn btn--ghost" id="rMore">Показать ещё</button></div></div>`;
  let list = [];
  const sub = () => {
    cleanup();
    unsubs.push(subscribeLatestReviews(size, (l) => {
      list = l;
      $("#rList").innerHTML = l.length ? l.map(r => `<div class="review" data-id="${r.id}">
        <div class="review__head"><div class="avatar">${esc((r.userName || "?")[0])}</div>
          <div><b>${esc(r.userName)}</b> → <a href="product.html?id=${r.productId}" style="color:var(--primary)">${esc(r.productName)}</a><div class="small muted">${timeAgo(r.createdAt)}</div></div>
          <div class="spacer"></div>${stars(r.rating)}<button class="btn btn--sm btn--danger" data-del>Удалить</button></div>
        <div>${esc(r.text) || `<span class="muted">Без текста</span>`}</div></div>`).join("") : emptyState("💬", "Отзывов пока нет");
      $("#rMore").hidden = l.length < size;
    }, (e) => toast(humanError(e), "error")));
  };
  $("#rMore").onclick = () => { size += 20; sub(); };
  $("#rList").onclick = async (e) => {
    if (!e.target.closest("[data-del]")) return;
    const r = list.find(x => x.id === e.target.closest("[data-id]").dataset.id);
    if (!await confirmDialog("Удалить отзыв как некорректный? Рейтинг товара будет пересчитан.", { okText: "Удалить", danger: true })) return;
    try { await deleteReview(r); toast("Отзыв удалён", "success"); } catch (err) { toast(humanError(err), "error"); }
  };
  sub();
}

/* ================= Промокоды ================= */
function promos(root) {
  root.innerHTML = `<div class="card panel">
    <h3>Промокоды</h3>
    <form id="promoForm" class="row" style="margin-bottom:16px">
      <input class="input" name="code" placeholder="КОД" required pattern="[A-Za-z0-9]{3,20}" style="max-width:180px;text-transform:uppercase">
      <input class="input" name="percent" type="number" min="1" max="90" placeholder="% скидки" required style="max-width:130px">
      <button class="btn btn--primary">Создать</button>
    </form>
    <table class="table"><thead><tr><th>Код</th><th>Скидка</th><th>Использований</th><th>Статус</th><th></th></tr></thead><tbody id="prBody"></tbody></table></div>`;
  unsubs.push(subscribePromos((list) => {
    $("#prBody").innerHTML = list.length ? list.map(p => `<tr data-id="${p.id}"><td><b>${esc(p.id)}</b></td><td>${p.percent}%</td><td>${p.uses || 0}</td>
      <td><label class="check"><input type="checkbox" data-toggle ${p.active ? "checked" : ""}> ${p.active ? "активен" : "выключен"}</label></td>
      <td><button class="btn btn--sm btn--ghost" data-del style="color:var(--red)">🗑</button></td></tr>`).join("") : `<tr><td colspan="5" class="muted">Промокодов нет</td></tr>`;
  }));
  $("#promoForm").onsubmit = async (e) => {
    e.preventDefault();
    try { await savePromo(e.target.code.value.trim(), e.target.percent.value); e.target.reset(); toast("Промокод создан", "success"); }
    catch (err) { toast(humanError(err), "error"); }
  };
  $("#prBody").onchange = (e) => { const t = e.target.closest("[data-toggle]"); if (t) togglePromo(t.closest("tr").dataset.id, t.checked).catch(err => toast(humanError(err), "error")); };
  $("#prBody").onclick = async (e) => {
    if (!e.target.closest("[data-del]")) return;
    const id = e.target.closest("tr").dataset.id;
    if (await confirmDialog(`Удалить промокод ${id}?`, { okText: "Удалить", danger: true })) deletePromo(id).catch(err => toast(humanError(err), "error"));
  };
}

render();
