// Общие константы приложения
export const STORE_NAME = "NEXUS";
export const CURRENCY = "₸";
export const PAGE_SIZE = 12;          // размер страницы каталога
export const SIMILAR_PAGE_SIZE = 4;   // размер страницы похожих товаров
export const REVIEWS_PAGE_SIZE = 5;
export const FREE_DELIVERY_FROM = 50000;
export const DELIVERY_PRICE = 1500;

// E-mail'ы, которые автоматически получают роль admin (bootstrap первого администратора).
// Дублируется в firestore.rules.
export const ADMIN_EMAILS = ["admin@nexus-store.kz"];

export const CATEGORIES = [
  { id: "smartphones", name: "Смартфоны", emoji: "📱", img: "1592750475338-74b7b21085ab" },
  { id: "laptops", name: "Ноутбуки", emoji: "💻", img: "1517336714731-489689fd1ca8" },
  { id: "tablets", name: "Планшеты", emoji: "📲", img: "1527698266440-12104e498b76" },
  { id: "audio", name: "Аудио", emoji: "🎧", img: "1505740420928-5e560c06d30e" },
  { id: "watches", name: "Умные часы", emoji: "⌚", img: "1546868871-7041f2a55e12" },
  { id: "gaming", name: "Игры", emoji: "🎮", img: "1606144042614-b2417e99c4e3" },
  { id: "photo", name: "Фото и видео", emoji: "📷", img: "1516035069371-29a1b244cc32" },
  { id: "smarthome", name: "Умный дом", emoji: "🏠", img: "1519558260268-cde7e03a0152" },
  { id: "accessories", name: "Аксессуары", emoji: "🔌", img: "1618384887929-16ec33fab9ef" }
];
/** Фото с Unsplash (бесплатная лицензия): id → URL нужного размера */
export const unsplash = (id, w = 640) => `https://images.unsplash.com/photo-${id}?w=${w}&q=70&auto=format&fit=crop`;

export const categoryById = (id) => CATEGORIES.find(c => c.id === id) || { id, name: id, emoji: "📦" };

export const SORTS = [
  { id: "new", name: "Сначала новые", field: "createdAt", dir: "desc" },
  { id: "price_asc", name: "Сначала дешёвые", field: "price", dir: "asc" },
  { id: "price_desc", name: "Сначала дорогие", field: "price", dir: "desc" },
  { id: "rating", name: "По рейтингу", field: "ratingAvg", dir: "desc" },
  { id: "popular", name: "Популярные", field: "salesCount", dir: "desc" }
];

export const ORDER_STATUSES = {
  new:        { name: "Новый",       color: "blue",   step: 0 },
  processing: { name: "В обработке", color: "amber",  step: 1 },
  shipped:    { name: "Отправлен",   color: "violet", step: 2 },
  delivered:  { name: "Доставлен",   color: "green",  step: 3 },
  cancelled:  { name: "Отменён",     color: "red",    step: -1 }
};
export const STATUS_FLOW = ["new", "processing", "shipped", "delivered"];
