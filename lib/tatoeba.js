// مثال‌های واقعی آلمانی–فارسی از Tatoeba (CC BY 2.0 FR).
// داده در tatoeba-data.js است: مدخل → حداکثر ۲ مثال {de, fa}،
// فیلترشده روی جمله‌های مستقیم آلمانی–فارسی Tatoeba.
import { TATOEBA_EXAMPLES } from './tatoeba-data.js';

/** مثال‌های Tatoeba برای یک مدخل؛ نبودشان خطا نیست، [] برمی‌گردد. */
export function getTatoebaExamples(word) {
  const w = String(word || '').trim();
  if (!w) return [];
  const cap = w.charAt(0).toUpperCase() + w.slice(1);
  const lower = w.toLowerCase();
  for (const key of [w, cap, lower]) {
    const hit = TATOEBA_EXAMPLES[key];
    if (Array.isArray(hit) && hit.length) return hit.slice(0, 2);
  }
  return [];
}
