// Главная: витрина + каталог с пагинацией, поиском, фильтрами (категория, скидка, цена), сортировкой и real-time
import { mountLayout, $, $$, esc, money, productCard, skeletonCards, emptyState, toast, humanError, qs, getRecent, plural, debounce } from "../core/ui.js";
import { CATEGORIES, SORTS, categoryById, unsplash } from "../core/config.js";
import { subscribeCatalog, fetchCatalogPage, countCatalog, fetchBestsellers, countByCategory, hasPriceRange } from "../db/products.js";
import { bindProductGrid, paintFavs } from "../core/actions.js";

mountLayout("catalog");

const state = {
  category: qs("cat") || "",
  onSale: qs("sale") === "1",
  search: qs("q") || "",
  sort: qs("sort") || "new",
  minPrice: Number(qs("min")) || 0,
  maxPrice: Number(qs("max")) || 0,
  items: [],          // первая страница (real-time, onSnapshot)
  more: [],           // последующие страницы (getDocs + startAfter)
  lastDoc: null,
  hasMore: false,
  clientSide: false,
  unsub: null,
  knownIds: new Set()
};
const isHome = !state.search && !state.category && !state.onSale && !hasPriceRange(state);

$("#app").innerHTML = `
  ${isHome ? `
  <section class="hero">
    <div class="hero__blob hero__blob--1"></div><div class="hero__blob hero__blob--2"></div>
    <div class="hero__content">
      <span class="pill-badge">🔥 Осенняя распродажа · до −20%</span>
      <h1>Техника, которая <span class="grad-text">делает жизнь проще</span></h1>
      <p>Смартфоны, ноутбуки, аудио и умный дом с официальной гарантией. Наличие и цены обновляются в реальном времени.</p>
      <div class="row">
        <a href="#catalog" class="btn btn--light btn--lg">Смотреть каталог →</a>
        <a href="index.html?sale=1#catalog" class="btn btn--glass btn--lg">Товары со скидкой</a>
      </div>
      <div class="hero__stats">
        <div><b id="statProducts">—</b><span>товаров</span></div>
        <div><b>${CATEGORIES.length}</b><span>категорий</span></div>
        <div><b>12 мес</b><span>гарантия</span></div>
      </div>
    </div>
    <div class="hero__visual" aria-hidden="true">
      <img class="hero__photo" src="${unsplash("1511707171634-5f897ff02aa9", 900)}" alt="">
      <div class="float-card float-card--1"><img src="${unsplash("1592750475338-74b7b21085ab", 120)}" alt=""><span>iPhone 16 Pro</span></div>
      <div class="float-card float-card--2"><img src="${unsplash("1618366712010-f4ae9c647dcb", 120)}" alt=""><span>−11%</span></div>
      <div class="float-card float-card--3"><img src="${unsplash("1517336714731-489689fd1ca8", 120)}" alt=""><span>MacBook Air</span></div>
    </div>
  </section>

  <section class="promo-row">
    <a class="promo promo--a" href="index.html?cat=audio#catalog" style="--img:url('${unsplash("1505740420928-5e560c06d30e", 800)}')"><span>Аудио</span><b>Звук без проводов</b></a>
    <a class="promo promo--b" href="index.html?cat=gaming#catalog" style="--img:url('${unsplash("1612287230202-1ff1d85d1bdf", 800)}')"><span>Игры</span><b>Консоли и геймпады</b></a>
    <a class="promo promo--c" href="index.html?cat=smarthome#catalog" style="--img:url('${unsplash("1558317374-067fb5f30001", 800)}')"><span>Умный дом</span><b>Автоматизируйте быт</b></a>
  </section>

  <div class="section-title"><h2>Категории</h2></div>
  <section class="cat-tiles" id="catTiles">
    ${CATEGORIES.map(c => `<a class="cat-tile" href="index.html?cat=${c.id}#catalog" data-cat="${c.id}"><span class="cat-tile__img"><img src="${unsplash(c.img, 240)}" alt="" loading="lazy"></span><b>${esc(c.name)}</b><small data-count="${c.id}">&nbsp;</small></a>`).join("")}
  </section>

  <div class="section-title"><h2>🔥 Хиты продаж</h2><span class="muted small">по количеству покупок</span></div>
  <div class="hscroll" id="bestsellers">${skeletonCards(5)}</div>` : ""}

  <div id="catalog" class="anchor"></div>
  <nav class="cats" id="cats" aria-label="Категории">
    <button class="cat-chip" data-cat="">✨ Все</button>
    ${CATEGORIES.map(c => `<button class="cat-chip" data-cat="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join("")}
  </nav>
  <div class="toolbar">
    <div class="toolbar__title">
      <h1 id="title" style="margin:0"></h1>
      <div class="row"><span class="result-info" id="resultInfo"></span><span class="live-dot" title="Каталог обновляется в реальном времени (onSnapshot)">Live</span></div>
    </div>
    <div class="spacer"></div>
    <div class="price-filter" title="Диапазон цен">
      <input class="input" id="minPrice" type="number" min="0" step="1000" placeholder="Цена от" aria-label="Цена от">
      <span>—</span>
      <input class="input" id="maxPrice" type="number" min="0" step="1000" placeholder="до" aria-label="Цена до">
    </div>
    <label class="check switch"><input type="checkbox" id="onSale"><span></span> Со скидкой</label>
    <select class="input" id="sort" aria-label="Сортировка">
      ${SORTS.map(s => `<option value="${s.id}">${s.name}</option>`).join("")}
    </select>
  </div>
  <div class="active-filters" id="activeFilters"></div>
  <div class="grid" id="grid">${skeletonCards(8)}</div>
  <div class="load-more"><button class="btn btn--ghost btn--lg" id="moreBtn" hidden>Показать ещё</button></div>
  <section id="recentSection" hidden>
    <div class="section-title"><h2>Вы недавно смотрели</h2></div>
    <div class="hscroll" id="recent"></div>
  </section>
`;

const grid = $("#grid");
const allItems = () => [...state.items, ...state.more.filter(m => !state.items.some(i => i.id === m.id))];
bindProductGrid(grid, (id) => allItems().find(p => p.id === id));

function syncUrl() {
  const p = new URLSearchParams();
  if (state.search) p.set("q", state.search);
  if (state.category) p.set("cat", state.category);
  if (state.onSale) p.set("sale", "1");
  if (state.minPrice) p.set("min", state.minPrice);
  if (state.maxPrice) p.set("max", state.maxPrice);
  if (state.sort !== "new") p.set("sort", state.sort);
  history.replaceState(null, "", `${location.pathname}${p.toString() ? "?" + p : ""}${location.hash}`);
}

function renderControls() {
  $$(".cat-chip").forEach(b => b.classList.toggle("active", b.dataset.cat === state.category));
  $("#onSale").checked = state.onSale;
  $("#minPrice").value = state.minPrice || "";
  $("#maxPrice").value = state.maxPrice || "";
  // при диапазоне цен Firestore разрешает сортировать только по цене
  const ranged = hasPriceRange(state) && !state.search;
  $$("#sort option").forEach(o => o.disabled = ranged && !o.value.startsWith("price"));
  if (ranged && !state.sort.startsWith("price")) state.sort = "price_asc";
  $("#sort").value = state.sort;
  const cat = state.category ? categoryById(state.category) : null;
  $("#title").textContent = state.search ? `Поиск: «${state.search}»` : cat ? `${cat.emoji} ${cat.name}` : "Весь каталог";

  const chips = [];
  if (state.search) chips.push(["search", `Поиск: ${state.search}`]);
  if (cat) chips.push(["category", cat.name]);
  if (state.onSale) chips.push(["onSale", "Со скидкой"]);
  if (state.minPrice) chips.push(["minPrice", `от ${money(state.minPrice)}`]);
  if (state.maxPrice) chips.push(["maxPrice", `до ${money(state.maxPrice)}`]);
  $("#activeFilters").innerHTML = chips.length ? chips.map(([k, t]) => `<button class="filter-chip" data-clear="${k}">${esc(t)} ✕</button>`).join("") + `<button class="link-btn" data-clear="all">Сбросить всё</button>` : "";
}

function resetFilters() {
  state.search = ""; state.category = ""; state.onSale = false; state.minPrice = 0; state.maxPrice = 0;
  $(".header__search input").value = "";
}

function render() {
  const list = allItems();
  if (!list.length) {
    grid.innerHTML = emptyState("🔍", "Ничего не найдено",
      state.search ? "Попробуйте изменить запрос или сбросить фильтры" : "По выбранным фильтрам товаров нет",
      `<button class="btn btn--primary" id="resetBtn">Сбросить фильтры</button>`);
    $("#resetBtn").onclick = () => { resetFilters(); reload(); };
  } else {
    grid.innerHTML = list.map(p => productCard(p)).join("");
    paintFavs(grid);
  }
  $("#moreBtn").hidden = !state.hasMore;
  if (state.clientSide) $("#resultInfo").textContent = `Найдено: ${list.length} ${plural(list.length, ["товар", "товара", "товаров"])}`;
}

async function updateCount() {
  if (state.search) return;
  try {
    const n = await countCatalog(state);   // агрегатный запрос count() — документы не скачиваются
    $("#resultInfo").textContent = `${n} ${plural(n, ["товар", "товара", "товаров"])}`;
  } catch { /* count недоступен оффлайн */ }
}

function reload() {
  state.unsub && state.unsub();
  state.items = []; state.more = []; state.lastDoc = null; state.hasMore = false;
  state.knownIds = new Set();
  grid.innerHTML = skeletonCards(8);
  renderControls();
  syncUrl();
  updateCount();
  let first = true;
  state.unsub = subscribeCatalog(state, (res) => {
    state.items = res.items;
    state.clientSide = res.clientSide;
    // курсор берём из real-time страницы, пока пользователь не подгрузил следующие
    if (!state.more.length) { state.lastDoc = res.lastDoc; state.hasMore = res.hasMore; }
    if (!first && res.changes.length) {
      res.changes.filter(p => !state.knownIds.has(p.id) && (!p.createdAt || p.createdAt.seconds > Date.now() / 1000 - 600))
        .forEach(p => toast(`Новинка в каталоге: ${p.name}`, "info"));
      updateCount();
    }
    res.items.forEach(p => state.knownIds.add(p.id));
    first = false;
    render();
  }, (err) => {
    console.error(err);
    grid.innerHTML = emptyState("⚠️", "Не удалось загрузить каталог", humanError(err));
  });
}

$("#moreBtn").onclick = async (e) => {
  const btn = e.currentTarget;
  if (!state.lastDoc) return;
  btn.classList.add("loading");
  try {
    const res = await fetchCatalogPage(state, state.lastDoc);
    state.more.push(...res.items);
    state.lastDoc = res.lastDoc;
    state.hasMore = res.hasMore;
    render();
  } catch (err) { toast(humanError(err), "error"); }
  btn.classList.remove("loading");
};

$("#cats").onclick = (e) => {
  const b = e.target.closest(".cat-chip");
  if (!b) return;
  state.category = b.dataset.cat;
  reload();
};
$("#onSale").onchange = (e) => { state.onSale = e.target.checked; reload(); };
$("#sort").onchange = (e) => { state.sort = e.target.value; reload(); };
const onPrice = debounce(() => {
  const min = Math.max(0, Number($("#minPrice").value) || 0), max = Math.max(0, Number($("#maxPrice").value) || 0);
  if (max && min > max) return toast("Минимальная цена больше максимальной", "warn");
  state.minPrice = min; state.maxPrice = max; reload();
}, 600);
$("#minPrice").oninput = onPrice;
$("#maxPrice").oninput = onPrice;
$("#activeFilters").onclick = (e) => {
  const b = e.target.closest("[data-clear]"); if (!b) return;
  const k = b.dataset.clear;
  if (k === "all") resetFilters();
  else if (k === "search") { state.search = ""; $(".header__search input").value = ""; }
  else if (k === "onSale") state.onSale = false;
  else state[k] = k === "category" ? "" : 0;
  reload();
};

// Поиск из шапки без перезагрузки страницы
const searchForm = $(".header__search");
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  state.search = searchForm.q.value.trim();
  $("#suggest").hidden = true;
  reload();
  $("#catalog").scrollIntoView({ behavior: "smooth" });
});

// Витрина: хиты продаж и счётчики категорий
if (isHome) {
  fetchBestsellers(10).then(list => {
    const box = $("#bestsellers");
    box.innerHTML = list.map(p => productCard(p)).join("");
    bindProductGrid(box, (id) => list.find(p => p.id === id));
    paintFavs(box);
  }).catch(() => { $("#bestsellers").innerHTML = ""; });
  countByCategory(CATEGORIES.map(c => c.id)).then(map => {
    let total = 0;
    Object.entries(map).forEach(([id, n]) => {
      total += n || 0;
      const el = document.querySelector(`[data-count="${id}"]`);
      if (el && n !== null) el.textContent = `${n} ${plural(n, ["товар", "товара", "товаров"])}`;
    });
    if ($("#statProducts")) $("#statProducts").textContent = total;
  });
}

// Недавно просмотренные (localStorage)
const recent = getRecent();
if (recent.length) {
  $("#recentSection").hidden = false;
  $("#recent").innerHTML = recent.map(p => productCard(p)).join("");
  bindProductGrid($("#recent"), (id) => recent.find(p => p.id === id));
}

reload();
if (location.hash === "#catalog" || !isHome) setTimeout(() => $("#catalog").scrollIntoView(), 50);
