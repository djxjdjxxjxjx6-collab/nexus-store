// Единая точка инициализации Firebase
import { initializeApp } from "../sdk/app.js";
import { getAuth } from "../sdk/auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore
} from "../sdk/firestore.js";
import { firebaseConfig } from "../firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Оффлайн-кэш IndexedDB: повторные чтения идут из кэша, сайт работает при плохом интернете
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
  });
} catch (e) {
  console.warn("Persistent cache недоступен, используется память", e);
  _db = getFirestore(app);
}
export const db = _db;
