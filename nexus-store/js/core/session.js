// Сессия пользователя: Firebase Auth + профиль из Firestore (users/{uid}) в реальном времени
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "../sdk/auth.js";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp } from "../sdk/firestore.js";
import { ADMIN_EMAILS } from "./config.js";

const state = { user: null, profile: null, ready: false };
const listeners = new Set();
let unsubProfile = null;
let readyResolve;
const readyPromise = new Promise(r => (readyResolve = r));

function emit() {
  listeners.forEach(cb => { try { cb(state); } catch (e) { console.error(e); } });
}

async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const bootstrapAdmin = ADMIN_EMAILS.includes((user.email || "").toLowerCase());
  if (!snap.exists()) {
    let pending = null;
    try { pending = sessionStorage.getItem("nexus-pending-name"); sessionStorage.removeItem("nexus-pending-name"); } catch {}
    await setDoc(ref, {
      uid: user.uid,
      name: pending || user.displayName || (user.email || "").split("@")[0],
      email: user.email,
      phone: "",
      city: "",
      address: "",
      role: bootstrapAdmin ? "admin" : "user",
      settings: { newsletter: true, theme: "auto" },
      ordersCount: 0,
      totalSpent: 0,
      createdAt: serverTimestamp()
    });
  } else if (bootstrapAdmin && snap.data().role !== "admin") {
    await updateDoc(ref, { role: "admin" });
  }
  return ref;
}

onAuthStateChanged(auth, async (user) => {
  if (unsubProfile) { unsubProfile(); unsubProfile = null; }
  state.user = user;
  state.profile = null;
  if (!user) {
    state.ready = true; readyResolve(state); emit();
    return;
  }
  try {
    const ref = await ensureProfile(user);
    // Real-time: изменение роли/имени админом сразу отражается в интерфейсе
    unsubProfile = onSnapshot(ref, (snap) => {
      state.profile = snap.exists() ? { id: snap.id, ...snap.data() } : null;
      if (!state.ready) { state.ready = true; readyResolve(state); }
      emit();
    }, (err) => {
      console.error(err);
      if (!state.ready) { state.ready = true; readyResolve(state); }
      emit();
    });
  } catch (e) {
    console.error("Не удалось загрузить профиль", e);
    state.ready = true; readyResolve(state); emit();
  }
});

export const getSession = () => state;
export const sessionReady = () => readyPromise;
export function onSession(cb) { listeners.add(cb); if (state.ready) cb(state); return () => listeners.delete(cb); }

export function isAdmin(s = state) {
  return !!s.user && (s.profile?.role === "admin" || ADMIN_EMAILS.includes((s.user.email || "").toLowerCase()));
}

/** Требует вход. Если пользователь не авторизован — редирект на страницу входа. */
export async function requireAuth() {
  const s = await sessionReady();
  if (!s.user) {
    location.href = `auth.html?next=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}`;
    return new Promise(() => {});
  }
  return s;
}

export async function logout() {
  await signOut(auth);
  location.href = "index.html";
}
