// Главная: каталог с пагинацией, поиском, фильтрами, сортировкой и real-time обновлениями
import { mountLayout, $, esc, productCard, skeletonCards, emptyState, toast, humanError, qs, getRecent, plural } from "../core/ui.js";
import { CATEGORIES, SORTS, categoryById } from "../core/config.js";
import { subscribeCatalog, fetchCatalogPage, countCatalog } from "../db/products.js";
import { bindProductGrid, paintFavs } from "../core/actions.js";

mountLayout("catalog");

const state = {
  category: qs("cat") || "",
  onSale: qs("sale") === "1",
  search: qs("q") || "",
  sort: qs("sort") || "new",
  items: [],          // первая страница (real-time)
  more: [],           // последующие страницы (getDocs)
  lastDoc: null,
  hasMore: false,
  clientSide: false,
  unsub: null,
  knownIds: new Set()
};

$("#app").innerHTML = `
  ${state.search ? "" : `
  <section class="hero">
    <div class="hero__emoji">🎧</div>
    <span class="badge badge--sale">Осенняя распродажа</span>
    <h1>Электроника, которая делает жизнь проще</h1>
    <p>Смартфоны, ноутбуки, гаджеты и аксессуары с доставкой по всему Казахстану. Промокод <b>WELCOME10</b> — скидка 10% на первый заказ.</p>
    <div class="row"><a href="#catalog" class="btn btn--lg">Смотреть каталог →</a></div>
    <div class="hero__stats">
      <div><b id="statProducts">—</b><span>товаров</span></div>
      <div><b>9</b><span>категорий</span></div>
      <div><b>24/7</b><span>поддержка</span></div>
    </div>
  </section>`}
  <div id="catalog"></div>
  <nav class="cats" id="cats" aria-label="Категории">
    <button class="cat-chip" data-cat="">✨ Все</button>
    ${CATEGORIES.map(c => `<button class="cat-chip" data-cat="${c.id}">${c.emoji} ${esc(c.name)}</button>`).join("")}
  </nav>
  <div class="toolbar">
    <div>
      <h1 id="title" style="margin:0"></h1>
      <div class="row"><span class="result-info" id="resultInfo"></span><span class="live-dot" title="Каталог обновляется в реальном времени">Live</span></div>
    </div>
    <div class="spacer"></div>
    <label class="check"><input type="checkbox" id="onSale"> 🔥 Только со скидкой</label>
    <select class="input" id="sort" aria-label="Сортировка">
      ${SORTS.map(s => `<option value="${s.id}">${s.name}</option>`).join("")}
    </select>
  </div>
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
  if (state.sort !== "new") p.set("sort", state.sort);
  history.replaceState(null, "", `${location.pathname}${p.toString() ? "?" + p : ""}`);
}

function renderControls() {
  document.querySelectorAll(".cat-chip").forEach(b => b.classList.toggle("active", b.dataset.cat === state.category));
  $("#onSale").checked = state.onSale;
  $("#sort").value = state.sort;
  const cat = state.category ? categoryById(state.category) : null;
  $("#title").textContent = state.search ? `Поиск: «${state.search}»` : cat ? `${cat.emoji} ${cat.name}` : "Каталог";
}

function render() {
  const list = allItems();
  if (!list.length) {
    grid.innerHTML = emptyState("🔍", "Ничего не найдено",
      state.search ? "Попробуйте изменить запрос или сбросить фильтры" : "В этой категории пока нет товаров",
      `<button class="btn btn--primary" id="resetBtn">Сбросить фильтры</button>`);
    $("#resetBtn").onclick = () => { state.search = ""; state.category = ""; state.onSale = false; $(".header__search input").value = ""; reload(); };
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
    const n = await countCatalog(state);
    $("#resultInfo").textContent = `${n} ${plural(n, ["товар", "товара", "товаров"])}`;
    if (!state.category && !state.onSale && $("#statProducts")) $("#statProducts").textContent = n;
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
      res.changes.filter(p => !state.knownIds.has(p.id) && (!p.createdAt || p.createdAt.seconds > Date.now() / 1000 - 600)).forEach(p => toast(`Новинка в каталоге: ${p.name}`, "info"));
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

// Поиск из шапки без перезагрузки страницы
const searchForm = $(".header__search");
searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  state.search = searchForm.q.value.trim();
  reload();
  document.getElementById("catalog").scrollIntoView({ behavior: "smooth" });
});

// Недавно просмотренные
const recent = getRecent();
if (recent.length) {
  $("#recentSection").hidden = false;
  $("#recent").innerHTML = recent.map(p => productCard(p)).join("");
  bindProductGrid($("#recent"), (id) => recent.find(p => p.id === id));
}

reload();
