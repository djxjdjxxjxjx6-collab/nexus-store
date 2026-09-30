// Детальная страница товара: real-time цена/наличие, отзывы, похожие товары
import {
  mountLayout, $, $$, esc, money, stars, productImage, productCard, discountPct, emptyState,
  toast, humanError, qs, timeAgo, pushRecent, plural, confirmDialog
} from "../core/ui.js";
import { categoryById, REVIEWS_PAGE_SIZE, SIMILAR_PAGE_SIZE, FREE_DELIVERY_FROM } from "../core/config.js";
import { subscribeProduct, getDetails, fetchSimilar } from "../db/products.js";
import { subscribeProductReviews, fetchMoreReviews, saveReview, deleteReview, reviewId } from "../db/reviews.js";
import { addProductToCart, toggleProductFav, bindProductGrid, isFav, onFavorites, paintFavs } from "../core/actions.js";
import { onSession, getSession, isAdmin } from "../core/session.js";

mountLayout("catalog");
const id = qs("id");
const app = $("#app");
let product = null;
let qty = 1;
let rendered = false;

if (!id) {
  app.innerHTML = emptyState("🤷", "Товар не указан", "", `<a class="btn btn--primary" href="index.html">В каталог</a>`);
} else {
  app.innerHTML = `<div class="product-layout" style="margin-top:28px"><div class="sk" style="aspect-ratio:1;border-radius:24px"></div><div><div class="sk sk-line w60" style="height:32px"></div><div class="sk sk-line"></div><div class="sk sk-line w40"></div></div></div>`;
  subscribeProduct(id, (p) => {
    if (!p) { app.innerHTML = emptyState("🗑️", "Товар не найден", "Возможно, он был удалён", `<a class="btn btn--primary" href="index.html">В каталог</a>`); return; }
    const old = product;
    product = p;
    if (!rendered) { renderPage(); rendered = true; pushRecent(p); }
    else updateLive(old, p);
  }, (e) => { app.innerHTML = emptyState("⚠️", "Ошибка загрузки", humanError(e)); });
}

function stockHtml(p) {
  if (!p.stock) return `<div class="stock-line out">✕ Нет в наличии</div>`;
  if (p.stock <= 5) return `<div class="stock-line low">⚡ Осталось всего ${p.stock} шт.</div>`;
  return `<div class="stock-line in">✓ В наличии: ${p.stock} шт.</div>`;
}
function priceHtml(p) {
  const pct = discountPct(p);
  return `<span class="price__now">${money(p.price)}</span>${pct ? `<span class="price__old">${money(p.oldPrice)}</span><span class="badge badge--sale">−${pct}%</span>` : ""}`;
}

function renderPage() {
  const p = product;
  const cat = categoryById(p.category);
  document.title = `${p.name} — NEXUS store`;
  document.querySelector('meta[name="description"]')?.setAttribute("content", `${p.name}: ${p.shortDesc || ""} Цена ${money(p.price)}.`);
  app.innerHTML = `
    <nav class="breadcrumbs"><a href="index.html">Главная</a>›<a href="index.html?cat=${p.category}">${esc(cat.name)}</a>›<span>${esc(p.name)}</span></nav>
    <div class="product-layout">
      <div class="product-gallery card">${productImage(p, "pimg--xl")}</div>
      <div class="product-info">
        <div class="muted">${cat.emoji} ${esc(cat.name)} · <b>${esc(p.brand)}</b></div>
        <h1>${esc(p.name)}</h1>
        <a href="#reviews" class="row" id="ratingLine">${stars(p.ratingAvg)} <b>${(p.ratingAvg || 0).toFixed(1)}</b> <span class="muted">${p.ratingCount || 0} ${plural(p.ratingCount || 0, ["отзыв", "отзыва", "отзывов"])}</span></a>
        <p class="muted">${esc(p.shortDesc || "")}</p>
        <div class="product-price" id="priceBox">${priceHtml(p)}</div>
        <div id="stockBox">${stockHtml(p)}</div>
        <div class="buy-box">
          <div class="qty"><button id="qMinus" aria-label="Меньше">−</button><input id="qInput" type="number" value="1" min="1"><button id="qPlus" aria-label="Больше">+</button></div>
          <button class="btn btn--primary btn--lg" id="addBtn">🛒 В корзину</button>
          <button class="btn btn--ghost btn--lg" id="buyBtn">Купить сейчас</button>
          <button class="btn btn--ghost btn--lg btn--icon fav-inline" id="favBtn" title="В избранное" aria-label="В избранное">♥</button>
          <button class="btn btn--ghost btn--lg btn--icon" id="shareBtn" title="Поделиться" aria-label="Поделиться">⤴</button>
        </div>
        <div class="installments card">
          <span>💳 Рассрочка 0-0-12</span><b>${money(Math.ceil(p.price / 12))} / мес</b>
        </div>
        <div class="perks">
          <div class="perk"><b>🚚</b>Бесплатная доставка от ${money(FREE_DELIVERY_FROM)}</div>
          <div class="perk"><b>🛡️</b>Официальная гарантия 12 месяцев</div>
          <div class="perk"><b>↩️</b>Возврат в течение 14 дней</div>
        </div>
        ${p.tags?.length ? `<div class="row" style="margin-top:16px">${p.tags.map(t => `<a class="pill" href="index.html?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join("")}</div>` : ""}
      </div>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab active" data-tab="desc">Описание</button>
      <button class="tab" data-tab="specs">Характеристики</button>
      <button class="tab" data-tab="reviews" id="reviewsTab">Отзывы (${p.ratingCount || 0})</button>
    </div>
    <section data-panel="desc" class="card panel"><div class="description" id="desc"><div class="sk sk-line"></div><div class="sk sk-line w60"></div></div></section>
    <section data-panel="specs" class="card panel" hidden><table class="specs" id="specs"></table></section>
    <section data-panel="reviews" id="reviews" hidden>
      <div class="reviews-layout">
        <div class="card panel rating-summary" id="ratingSummary"></div>
        <div>
          <div class="card panel" id="reviewFormBox"></div>
          <div id="reviewsList"></div>
          <div class="load-more"><button class="btn btn--ghost" id="moreReviews" hidden>Больше отзывов</button></div>
        </div>
      </div>
    </section>

    <div class="sticky-buy" id="stickyBuy">
      <div><b>${esc(p.name)}</b><span id="stickyPrice">${money(p.price)}</span></div>
      <button class="btn btn--primary" id="stickyAdd">🛒 В корзину</button>
    </div>

    <div class="section-title"><h2>Похожие товары</h2></div>
    <div class="grid" id="similar"></div>
    <div class="load-more"><button class="btn btn--ghost" id="moreSimilar" hidden>Показать ещё похожие</button></div>
  `;

  // Вкладки
  $$(".tab").forEach(t => t.onclick = () => {
    $$(".tab").forEach(x => x.classList.toggle("active", x === t));
    $$("[data-panel]").forEach(pn => pn.hidden = pn.dataset.panel !== t.dataset.tab);
  });
  $("#ratingLine").onclick = (e) => { e.preventDefault(); $("#reviewsTab").click(); $("#reviews").scrollIntoView({ behavior: "smooth" }); };

  // Количество
  const setQty = (v) => { qty = Math.max(1, Math.min(v, product.stock || 1)); $("#qInput").value = qty; };
  $("#qMinus").onclick = () => setQty(qty - 1);
  $("#qPlus").onclick = () => setQty(qty + 1);
  $("#qInput").onchange = (e) => setQty(parseInt(e.target.value, 10) || 1);
  $("#addBtn").onclick = (e) => addProductToCart(product, qty, e.currentTarget);
  $("#buyBtn").onclick = async (e) => {
    if (!getSession().user) return addProductToCart(product, qty);
    await addProductToCart(product, qty, e.currentTarget);
    location.href = "cart.html";
  };
  $("#stickyAdd").onclick = (e) => addProductToCart(product, qty, e.currentTarget);
  $("#shareBtn").onclick = async () => {
    const data = { title: product.name, text: `${product.name} — ${money(product.price)} в NEXUS store`, url: location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else { await navigator.clipboard.writeText(location.href); toast("Ссылка скопирована", "success"); }
    } catch { /* пользователь отменил */ }
  };
  // липкая панель покупки на мобильных, когда основная кнопка ушла за экран
  new IntersectionObserver(([en]) => $("#stickyBuy").classList.toggle("show", !en.isIntersecting && en.boundingClientRect.top < 0))
    .observe($("#addBtn"));
  $("#favBtn").dataset.fav = product.id;
  $("#favBtn").onclick = () => toggleProductFav(product);
  paintFavs();
  onFavorites(() => paintFavs());
  refreshBuyState();

  loadDetails();
  initReviews();
  initSimilar();
}

function refreshBuyState() {
  const out = !product.stock;
  $("#addBtn").disabled = out;
  if ($("#stickyAdd")) $("#stickyAdd").disabled = out;
  $("#buyBtn").disabled = out;
  if (qty > (product.stock || 1)) { qty = Math.max(1, product.stock || 1); $("#qInput").value = qty; }
}

/** Живые изменения цены/остатка/рейтинга (например, админ изменил товар или кто-то купил). */
function updateLive(old, p) {
  if (old.price !== p.price || old.oldPrice !== p.oldPrice) {
    $("#priceBox").innerHTML = priceHtml(p);
    if ($("#stickyPrice")) $("#stickyPrice").textContent = money(p.price);
    $("#priceBox").classList.remove("flash"); void $("#priceBox").offsetWidth; $("#priceBox").classList.add("flash");
    toast("Цена обновилась", "info");
  }
  if (old.stock !== p.stock) {
    $("#stockBox").innerHTML = stockHtml(p);
    $("#stockBox").classList.remove("flash"); void $("#stockBox").offsetWidth; $("#stockBox").classList.add("flash");
    refreshBuyState();
  }
  if (old.ratingAvg !== p.ratingAvg || old.ratingCount !== p.ratingCount) {
    $("#ratingLine").innerHTML = `${stars(p.ratingAvg)} <b>${(p.ratingAvg || 0).toFixed(1)}</b> <span class="muted">${p.ratingCount || 0} ${plural(p.ratingCount || 0, ["отзыв", "отзыва", "отзывов"])}</span>`;
    $("#reviewsTab").textContent = `Отзывы (${p.ratingCount || 0})`;
    renderSummary();
  }
  if (old.name !== p.name) $("h1").textContent = p.name;
}

async function loadDetails() {
  try {
    const d = await getDetails(product.id);
    $("#desc").textContent = d.description || product.shortDesc || "Описание скоро появится.";
    const specs = Object.entries(d.specs || {});
    $("#specs").innerHTML = specs.length ? specs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("") : `<tr><td colspan="2" class="muted">Характеристики не указаны</td></tr>`;
  } catch (e) { $("#desc").textContent = humanError(e); }
}

/* ---------- Отзывы ---------- */
let liveReviews = [], moreReviews = [], lastReviewDoc = null, reviewsHasMore = false, myReview = null;

function renderSummary() {
  const p = product;
  const all = [...liveReviews, ...moreReviews];
  const dist = [5, 4, 3, 2, 1].map(n => all.filter(r => r.rating === n).length);
  const max = Math.max(1, ...dist);
  $("#ratingSummary").innerHTML = `
    <div class="big">${(p.ratingAvg || 0).toFixed(1)}</div>
    <div>${stars(p.ratingAvg, "lg")}</div>
    <p class="muted">${p.ratingCount || 0} ${plural(p.ratingCount || 0, ["оценка", "оценки", "оценок"])}</p>
    ${[5, 4, 3, 2, 1].map((n, i) => `<div class="hbar" style="grid-template-columns:30px 1fr 30px"><span>${n}★</span><div class="hbar__track"><div style="width:${dist[i] / max * 100}%;background:#ffb400"></div></div><span class="muted">${dist[i]}</span></div>`).join("")}
    <p class="small muted">Распределение по загруженным отзывам</p>`;
}

function reviewHtml(r, s) {
  const mine = s.user && r.userId === s.user.uid;
  const canDel = mine || isAdmin(s);
  return `<div class="review" data-rid="${r.id}">
    <div class="review__head">
      <div class="avatar">${esc((r.userName || "?")[0].toUpperCase())}</div>
      <div><b>${esc(r.userName)}</b> ${mine ? `<span class="badge badge--new">Вы</span>` : ""}<div class="small muted">${timeAgo(r.createdAt)}${r.edited ? " · изменён" : ""}</div></div>
      <div class="spacer"></div>${stars(r.rating)}
    </div>
    <div>${esc(r.text) || `<span class="muted">Без комментария</span>`}</div>
    ${canDel ? `<div class="row" style="margin-top:8px">${mine ? `<button class="link-btn" data-edit>✎ Изменить</button>` : ""}<button class="link-btn" data-del>🗑 Удалить${!mine ? " (модерация)" : ""}</button></div>` : ""}
  </div>`;
}

function renderReviews() {
  const s = getSession();
  const all = [...liveReviews, ...moreReviews.filter(m => !liveReviews.some(l => l.id === m.id))];
  $("#reviewsList").innerHTML = all.length ? all.map(r => reviewHtml(r, s)).join("") : emptyState("💬", "Отзывов пока нет", "Будьте первым!");
  $("#moreReviews").hidden = !reviewsHasMore;
  renderSummary();
}

function renderReviewForm() {
  const s = getSession();
  const box = $("#reviewFormBox");
  if (!s.user) { box.innerHTML = `<p style="margin:0">Чтобы оставить отзыв, <a href="auth.html?next=${encodeURIComponent("product.html?id=" + id)}" style="color:var(--primary);font-weight:600">войдите</a>.</p>`; return; }
  const r = myReview;
  box.innerHTML = `
    <h3>${r ? "Ваш отзыв" : "Оставить отзыв"}</h3>
    <form id="reviewForm">
      <div class="star-input">${[5, 4, 3, 2, 1].map(n => `<input type="radio" name="rating" id="st${n}" value="${n}" ${(r?.rating || 5) === n ? "checked" : ""}><label for="st${n}" title="${n}">★</label>`).join("")}</div>
      <div class="field"><textarea class="input" name="text" maxlength="2000" placeholder="Расскажите о плюсах и минусах товара">${esc(r?.text || "")}</textarea></div>
      <button class="btn btn--primary" type="submit">${r ? "Сохранить изменения" : "Опубликовать"}</button>
    </form>`;
  $("#reviewForm").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button[type=submit]");
    btn.classList.add("loading");
    try {
      await saveReview({ product, user: s.user, profile: s.profile, rating: e.target.rating.value, text: e.target.text.value });
      toast(r ? "Отзыв обновлён" : "Спасибо за отзыв!", "success");
    } catch (err) { toast(humanError(err), "error"); }
    btn.classList.remove("loading");
  };
}

function initReviews() {
  let unsub = null;
  onSession((s) => { renderReviewForm(); renderReviews(); });
  unsub = subscribeProductReviews(product.id, REVIEWS_PAGE_SIZE, (items, snap) => {
    liveReviews = items;
    if (!moreReviews.length) { lastReviewDoc = snap.docs[snap.docs.length - 1]; reviewsHasMore = snap.docs.length === REVIEWS_PAGE_SIZE; }
    const s = getSession();
    const mine = s.user ? items.find(r => r.id === reviewId(product.id, s.user.uid)) : null;
    const hadMine = !!myReview;
    myReview = mine || moreReviews.find(r => s.user && r.userId === s.user.uid) || null;
    if (!!myReview !== hadMine) renderReviewForm();
    renderReviews();
  }, (e) => console.error(e));

  $("#moreReviews").onclick = async (e) => {
    e.currentTarget.classList.add("loading");
    try {
      const res = await fetchMoreReviews(product.id, lastReviewDoc, REVIEWS_PAGE_SIZE);
      moreReviews.push(...res.items); lastReviewDoc = res.lastDoc; reviewsHasMore = res.hasMore;
      renderReviews();
    } catch (err) { toast(humanError(err), "error"); }
    e.currentTarget.classList.remove("loading");
  };

  $("#reviewsList").onclick = async (e) => {
    const el = e.target.closest("[data-rid]");
    if (!el) return;
    const r = [...liveReviews, ...moreReviews].find(x => x.id === el.dataset.rid);
    if (e.target.closest("[data-edit]")) { $("#reviewFormBox").scrollIntoView({ behavior: "smooth", block: "center" }); $("#reviewForm textarea").focus(); }
    if (e.target.closest("[data-del]")) {
      if (!await confirmDialog("Удалить отзыв?", { okText: "Удалить", danger: true })) return;
      try {
        await deleteReview(r);
        moreReviews = moreReviews.filter(x => x.id !== r.id);
        toast("Отзыв удалён", "success");
      } catch (err) { toast(humanError(err), "error"); }
    }
  };
}

/* ---------- Похожие товары (пагинация) ---------- */
function initSimilar() {
  let items = [], last = null;
  const grid = $("#similar");
  bindProductGrid(grid, (pid) => items.find(p => p.id === pid));
  const load = async () => {
    try {
      const res = await fetchSimilar(product.category, product.id, last, SIMILAR_PAGE_SIZE);
      items.push(...res.items); last = res.lastDoc;
      grid.innerHTML = items.length ? items.map(p => productCard(p)).join("") : `<p class="muted">Похожих товаров пока нет</p>`;
      paintFavs(grid);
      $("#moreSimilar").hidden = !res.hasMore;
    } catch (err) { grid.innerHTML = `<p class="muted">${esc(humanError(err))}</p>`; }
  };
  $("#moreSimilar").onclick = async (e) => { e.currentTarget.classList.add("loading"); await load(); e.currentTarget.classList.remove("loading"); };
  load();
}
