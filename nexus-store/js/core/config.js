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
  { id: "smartphones", name: "Смартфоны", emoji: "📱" },
  { id: "laptops", name: "Ноутбуки", emoji: "💻" },
  { id: "tablets", name: "Планшеты", emoji: "📲" },
  { id: "audio", name: "Аудио", emoji: "🎧" },
  { id: "watches", name: "Умные часы", emoji: "⌚" },
  { id: "gaming", name: "Игры", emoji: "🎮" },
  { id: "photo", name: "Фото и видео", emoji: "📷" },
  { id: "smarthome", name: "Умный дом", emoji: "🏠" },
  { id: "accessories", name: "Аксессуары", emoji: "🔌" }
];
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
