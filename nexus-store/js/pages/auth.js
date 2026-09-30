// Вход, регистрация, восстановление пароля, «запомнить меня»
import { mountLayout, $, $$, toast, humanError, qs } from "../core/ui.js";
import { auth } from "../core/firebase.js";
import { sessionReady } from "../core/session.js";
import {
  signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendPasswordResetEmail,
  setPersistence, browserLocalPersistence, browserSessionPersistence
} from "../sdk/auth.js";

mountLayout("");
const next = qs("next") || "profile.html";
const safeNext = /^[\w-]+\.html(\?.*)?$/.test(next) ? next : "profile.html";

const s = await sessionReady();
if (s.user) { location.replace(safeNext); }

$("#app").innerHTML = `
  <div class="auth-wrap">
    <div class="card auth-card">
      <div class="tabs">
        <button class="tab active" data-t="login">Вход</button>
        <button class="tab" data-t="register">Регистрация</button>
        <button class="tab" data-t="reset">Забыли пароль?</button>
      </div>

      <form data-form="login">
        <h2>С возвращением 👋</h2>
        <div class="field"><label>E-mail</label><input class="input" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label>Пароль</label><input class="input" name="password" type="password" required autocomplete="current-password"></div>
        <label class="check" style="margin-bottom:16px"><input type="checkbox" name="remember" checked> Запомнить меня</label>
        <button class="btn btn--primary btn--lg btn--block">Войти</button>
      </form>

      <form data-form="register" hidden>
        <h2>Создать аккаунт</h2>
        <div class="field"><label>Имя</label><input class="input" name="name" required maxlength="60" autocomplete="name"></div>
        <div class="field"><label>E-mail</label><input class="input" name="email" type="email" required autocomplete="email"></div>
        <div class="field"><label>Пароль</label><input class="input" name="password" type="password" required minlength="6" autocomplete="new-password">
          <div class="pass-meter"><div id="meter"></div></div><span class="small muted" id="meterText">Минимум 6 символов</span></div>
        <div class="field"><label>Повторите пароль</label><input class="input" name="password2" type="password" required autocomplete="new-password"></div>
        <button class="btn btn--primary btn--lg btn--block">Зарегистрироваться</button>
      </form>

      <form data-form="reset" hidden>
        <h2>Восстановление пароля</h2>
        <p class="muted">Мы отправим ссылку для сброса пароля на ваш e-mail.</p>
        <div class="field"><label>E-mail</label><input class="input" name="email" type="email" required></div>
        <button class="btn btn--primary btn--lg btn--block">Отправить ссылку</button>
      </form>
    </div>
  </div>`;

const show = (t) => {
  $$(".tab").forEach(x => x.classList.toggle("active", x.dataset.t === t));
  $$("[data-form]").forEach(f => f.hidden = f.dataset.form !== t);
};
$$(".tab").forEach(t => t.onclick = () => show(t.dataset.t));
if (qs("mode") === "register") show("register");

const busy = (form, on) => form.querySelector("button").classList.toggle("loading", on);

$("[data-form=login]").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target; busy(f, true);
  try {
    await setPersistence(auth, f.remember.checked ? browserLocalPersistence : browserSessionPersistence);
    await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
    toast("Вы вошли в аккаунт", "success");
    setTimeout(() => location.replace(safeNext), 400);
  } catch (err) { toast(humanError(err), "error"); busy(f, false); }
};

const regForm = $("[data-form=register]");
regForm.password.oninput = (e) => {
  const v = e.target.value;
  let score = 0;
  if (v.length >= 6) score++; if (v.length >= 10) score++;
  if (/[A-ZА-Я]/.test(v) && /[a-zа-я]/.test(v)) score++; if (/\d/.test(v)) score++; if (/[^\w]/.test(v)) score++;
  const colors = ["#e5383b", "#e5383b", "#e8a100", "#e8a100", "#14a44d", "#14a44d"];
  const texts = ["Слишком короткий", "Слабый", "Средний", "Хороший", "Надёжный", "Отличный"];
  $("#meter").style.width = `${score * 20}%`; $("#meter").style.background = colors[score];
  $("#meterText").textContent = texts[score];
};
regForm.onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.password.value !== f.password2.value) return toast("Пароли не совпадают", "error");
  busy(f, true);
  try {
    await setPersistence(auth, browserLocalPersistence);
    try { sessionStorage.setItem("nexus-pending-name", f.name.value.trim()); } catch {}
    const cred = await createUserWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
    await updateProfile(cred.user, { displayName: f.name.value.trim() });
    // профиль users/{uid} с ролью user создаётся в session.js (ensureProfile)
    toast("Аккаунт создан! Добро пожаловать", "success");
    setTimeout(() => location.replace(safeNext), 700);
  } catch (err) { toast(humanError(err), "error"); busy(f, false); }
};

$("[data-form=reset]").onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target; busy(f, true);
  try {
    await sendPasswordResetEmail(auth, f.email.value.trim());
    toast("Письмо отправлено. Проверьте почту (и папку «Спам»)", "success", 5000);
    show("login");
  } catch (err) { toast(humanError(err), "error"); }
  busy(f, false);
};
