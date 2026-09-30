// Корзина: управление активными действиями и оформление заказа
import { mountLayout, $, esc, money, productImage, emptyState, toast, humanError, confirmDialog, plural } from "../core/ui.js";
import { requireAuth, getSession } from "../core/session.js";
import { subscribeCart, setQty, removeFromCart, clearCart } from "../db/cart.js";
import { placeOrder, calcTotals, checkPromo } from "../db/orders.js";
import { getProductsByIds } from "../db/products.js";
import { FREE_DELIVERY_FROM } from "../core/config.js";

mountLayout("cart");
const app = $("#app");
let items = [];
let stockMap = {};
let promo = null;
let step = "cart"; // cart | checkout | done

const s = await requireAuth();
app.innerHTML = `<div class="page-head"><div><h1>Корзина</h1><p class="muted" id="cartSub"></p></div></div><div id="cartRoot"><div class="sk" style="height:200px;border-radius:16px"></div></div>`;

subscribeCart(s.user.uid, async (list) => {
  items = list;
  // актуальные остатки и цены (корзина хранит копию, проверяем изменения)
  const missing = list.filter(i => !(i.productId in stockMap)).map(i => i.productId);
  if (missing.length) {
    const prods = await getProductsByIds(missing);
    prods.forEach(p => stockMap[p.id] = p);
    missing.forEach(id => { if (!(id in stockMap)) stockMap[id] = null; });
  }
  if (step !== "done") render();
}, (e) => { $("#cartRoot").innerHTML = emptyState("⚠️", "Ошибка", humanError(e)); });

function render() {
  const root = $("#cartRoot");
  const count = items.reduce((a, i) => a + i.qty, 0);
  $("#cartSub").textContent = count ? `${count} ${plural(count, ["товар", "товара", "товаров"])}` : "";
  if (!items.length) {
    root.innerHTML = emptyState("🛒", "Корзина пуста", "Добавьте товары из каталога", `<a class="btn btn--primary btn--lg" href="index.html">Перейти в каталог</a>`);
    return;
  }
  const t = calcTotals(items, promo);
  const left = Math.max(0, FREE_DELIVERY_FROM - (t.subtotal - t.discount));
  root.innerHTML = `
    <div class="cart-layout">
      <div>
        <div class="steps"><span class="${step === "cart" ? "active" : ""}">1. Корзина</span><span class="${step === "checkout" ? "active" : ""}">2. Доставка и оплата</span><span>3. Готово</span></div>
        ${step === "cart" ? cartList() : checkoutForm()}
      </div>
      <aside class="card panel summary">
        <h3>Ваш заказ</h3>
        <div class="summary__row"><span class="muted">Товары (${items.reduce((a, i) => a + i.qty, 0)})</span><span>${money(t.subtotal)}</span></div>
        ${t.discount ? `<div class="summary__row" style="color:var(--green)"><span>Промокод ${esc(promo.code)} (−${promo.percent}%)</span><span>−${money(t.discount)}</span></div>` : ""}
        <div class="summary__row"><span class="muted">Доставка</span><span>${t.deliveryPrice ? money(t.deliveryPrice) : "Бесплатно"}</span></div>
        ${left ? `<div class="small muted">До бесплатной доставки: <b>${money(left)}</b></div>` : `<div class="small" style="color:var(--green)">🎉 Бесплатная доставка</div>`}
        <div class="progress"><div style="width:${Math.min(100, (t.subtotal - t.discount) / FREE_DELIVERY_FROM * 100)}%"></div></div>
        <div class="summary__row summary__total"><span>Итого</span><span>${money(t.total)}</span></div>
        <form id="promoForm" class="row" style="margin:14px 0;flex-wrap:nowrap">
          <input class="input" name="code" placeholder="Промокод" value="${esc(promo?.code || "")}" ${promo ? "disabled" : ""}>
          ${promo ? `<button type="button" class="btn btn--ghost" id="promoRemove">✕</button>` : `<button class="btn btn--ghost">OK</button>`}
        </form>
        ${step === "cart"
          ? `<button class="btn btn--primary btn--lg btn--block" id="toCheckout" ${hasProblems() ? "disabled" : ""}>Перейти к оформлению</button>
             ${hasProblems() ? `<p class="small" style="color:var(--red)">Исправьте количество товаров, которых недостаточно на складе</p>` : ""}`
          : `<button class="btn btn--primary btn--lg btn--block" form="checkoutForm" id="placeBtn">Подтвердить заказ</button>
             <button class="btn btn--ghost btn--block" style="margin-top:8px" id="backToCart">← Назад в корзину</button>`}
        <p class="small muted" style="text-align:center">Подсказка: попробуйте промокод WELCOME10</p>
      </aside>
    </div>`;
  bind();
}

const problem = (i) => {
  const p = stockMap[i.productId];
  if (p === null) return "Товар больше не продаётся";
  if (p && p.stock < i.qty) return p.stock ? `В наличии только ${p.stock} шт.` : "Нет в наличии";
  return "";
};
const hasProblems = () => items.some(i => problem(i));

function cartList() {
  return `<div class="card">
    ${items.map(i => {
      const p = stockMap[i.productId];
      const priceChanged = p && p.price !== i.price;
      const err = problem(i);
      return `<div class="cart-item" data-id="${i.id}">
        <a href="product.html?id=${i.productId}">${productImage({ ...i, id: i.productId })}</a>
        <div>
          <a href="product.html?id=${i.productId}"><b>${esc(i.name)}</b></a>
          <div class="small muted">${esc(i.brand || "")} · ${money(i.price)} / шт.</div>
          ${priceChanged ? `<div class="small" style="color:var(--amber)">Цена изменилась: сейчас ${money(p.price)} — будет применена при оформлении</div>` : ""}
          ${err ? `<div class="small" style="color:var(--red)">⚠ ${esc(err)}</div>` : ""}
        </div>
        <div class="cart-item__actions">
          <b>${money(i.price * i.qty)}</b>
          <div class="qty"><button data-dec>−</button><input value="${i.qty}" data-qty type="number" min="1"><button data-inc>+</button></div>
          <button class="link-btn" data-remove>Удалить</button>
        </div>
      </div>`;
    }).join("")}
  </div>
  <div class="row" style="margin-top:14px"><a href="index.html" class="btn btn--ghost">← Продолжить покупки</a><div class="spacer"></div><button class="btn btn--ghost" id="clearBtn">Очистить корзину</button></div>`;
}

function checkoutForm() {
  const p = getSession().profile || {};
  return `<form class="card panel" id="checkoutForm">
    <h3>Получатель</h3>
    <div class="grid-2">
      <div class="field"><label>Имя и фамилия</label><input class="input" name="name" required value="${esc(p.name || "")}"></div>
      <div class="field"><label>Телефон</label><input class="input" name="phone" required type="tel" placeholder="+7 7__ ___ __ __" value="${esc(p.phone || "")}"></div>
    </div>
    <h3>Доставка</h3>
    <div class="radio-cards">
      <label class="radio-card"><input type="radio" name="method" value="courier" checked> 🚚 Курьером</label>
      <label class="radio-card"><input type="radio" name="method" value="pickup"> 🏬 Самовывоз</label>
    </div>
    <div class="grid-2">
      <div class="field"><label>Город</label><input class="input" name="city" required value="${esc(p.city || "Алматы")}"></div>
      <div class="field"><label>Адрес</label><input class="input" name="address" required value="${esc(p.address || "")}" placeholder="Улица, дом, квартира"></div>
    </div>
    <h3>Оплата</h3>
    <div class="radio-cards">
      <label class="radio-card"><input type="radio" name="payment" value="card" checked> 💳 Картой при получении</label>
      <label class="radio-card"><input type="radio" name="payment" value="cash"> 💵 Наличными</label>
    </div>
    <div class="field"><label>Комментарий к заказу</label><textarea class="input" name="comment" maxlength="500" placeholder="Например: позвонить за час"></textarea></div>
    <label class="check small"><input type="checkbox" name="save" checked> Сохранить данные в профиле</label>
  </form>`;
}

function bind() {
  $("#promoForm").onsubmit = async (e) => {
    e.preventDefault();
    const code = e.target.code.value;
    try {
      const pr = await checkPromo(code);
      if (!pr) return toast("Промокод не найден или неактивен", "error");
      promo = pr; toast(`Промокод применён: −${pr.percent}%`, "success"); render();
    } catch (err) { toast(humanError(err), "error"); }
  };
  const rm = $("#promoRemove"); if (rm) rm.onclick = () => { promo = null; render(); };

  if (step === "cart") {
    $("#toCheckout").onclick = () => { step = "checkout"; render(); window.scrollTo({ top: 0, behavior: "smooth" }); };
    $("#clearBtn").onclick = async () => {
      if (await confirmDialog("Удалить все товары из корзины?", { okText: "Очистить", danger: true })) {
        await clearCart(s.user.uid); toast("Корзина очищена");
      }
    };
    $("#cartRoot").querySelectorAll(".cart-item").forEach(row => {
      const it = items.find(i => i.id === row.dataset.id);
      const max = stockMap[it.productId]?.stock ?? 99;
      const update = async (q) => {
        q = Math.max(1, Math.min(q, max || 1));
        if (q === it.qty) { row.querySelector("[data-qty]").value = q; if (q === max) toast(`Максимум ${max} шт.`, "warn"); return; }
        try { await setQty(s.user.uid, it.id, q); } catch (err) { toast(humanError(err), "error"); }
      };
      row.querySelector("[data-dec]").onclick = () => update(it.qty - 1);
      row.querySelector("[data-inc]").onclick = () => update(it.qty + 1);
      row.querySelector("[data-qty]").onchange = (e) => update(parseInt(e.target.value, 10) || 1);
      row.querySelector("[data-remove]").onclick = async () => { await removeFromCart(s.user.uid, it.id); toast("Товар удалён"); };
    });
  } else {
    $("#backToCart").onclick = () => { step = "cart"; render(); };
    $("#checkoutForm").onsubmit = submitOrder;
  }
}

async function submitOrder(e) {
  e.preventDefault();
  const f = e.target;
  const btn = $("#placeBtn");
  btn.classList.add("loading");
  const delivery = {
    name: f.name.value.trim(), phone: f.phone.value.trim(), city: f.city.value.trim(),
    address: f.address.value.trim(), method: f.method.value, payment: f.payment.value, comment: f.comment.value.trim()
  };
  try {
    const sess = getSession();
    const orderId = await placeOrder({ user: sess.user, profile: sess.profile, items, promo, delivery });
    if (f.save.checked) {
      const { updateMyProfile } = await import("../db/users.js");
      const pr = sess.profile || {};
      updateMyProfile(sess.user.uid, { ...pr, name: delivery.name, phone: delivery.phone, city: delivery.city, address: delivery.address, newsletter: pr.settings?.newsletter, theme: pr.settings?.theme }).catch(() => {});
    }
    step = "done";
    $("#cartSub").textContent = "";
    $("#cartRoot").innerHTML = `<div class="card success-box">
      <div class="empty__icon">🎉</div>
      <h2>Заказ оформлен!</h2>
      <p class="muted">Мы уже начали его собирать. Статус заказа обновляется в личном кабинете в реальном времени.</p>
      <div class="row" style="justify-content:center;margin-top:18px">
        <a class="btn btn--primary btn--lg" href="profile.html?tab=orders&order=${orderId}">Отследить заказ</a>
        <a class="btn btn--ghost btn--lg" href="index.html">Продолжить покупки</a>
      </div></div>`;
    toast("Заказ успешно оформлен", "success");
  } catch (err) {
    console.error(err);
    toast(humanError(err), "error");
    btn.classList.remove("loading");
    // перечитываем актуальные остатки и возвращаемся к корзине, если есть проблемы
    const prods = await getProductsByIds(items.map(i => i.productId));
    stockMap = {};
    items.forEach(i => stockMap[i.productId] = prods.find(p => p.id === i.productId) || null);
    if (hasProblems()) { step = "cart"; render(); }
  }
}
