// Страница 404 / офлайн-заглушка
import { mountLayout, $, emptyState } from "../core/ui.js";
mountLayout("");
$("#app").innerHTML = emptyState("🛰️", navigator.onLine ? "Страница не найдена" : "Нет подключения к интернету",
  navigator.onLine ? "Возможно, ссылка устарела или товар был удалён." : "Проверьте соединение — сохранённые страницы работают офлайн.",
  `<a class="btn btn--primary btn--lg" href="index.html">На главную</a>`);
