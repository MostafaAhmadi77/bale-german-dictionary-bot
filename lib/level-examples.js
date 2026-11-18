// مثال‌های آلمانیِ سطح‌بندی‌شده برای یک کلمه (خواسته‌ی کاربر در v1.4.0):
// کاربر سطح CEFR و تعداد مثال را انتخاب می‌کند؛ مدل Gemini به همان تعداد جمله‌ی طبیعی
// با ترجمه‌ی فارسی می‌سازد. کاملا fail-open است: بدون کلید، خطا یا پاسخ نامعتبر
// => {ok:false, examples:[]} و اپ همان مثال‌های ویکی‌واژه/DWDS را نشان می‌دهد.
// نتیجه‌ی موفق ۳۰ روز در Redis کش می‌شود (ex:v1:{level}:{word}:{count}).

// همان الگوی lib/ai-check.js: مدل پین‌شده‌ی lite، بدون thinkingConfig، یک تلاش مجدد روی 503/429.
import { kv } from './store.js';

const MODEL = 'gemini-flash-lite-latest';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

/** سطح نامعتبر => B1 (سطح پیش‌فرض زبان‌آموز متوسط) */
export function normalizeLevel(level) {
  const lv = String(level || '').trim().toUpperCase();
  return LEVELS.includes(lv) ? lv : 'B1';
}

/** تعداد نامعتبر => 3؛ سقف ۵ تا هزینه و زمان پاسخ کنترل شود */
export function clampCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return 3;
  return Math.min(5, Math.max(1, Math.floor(n)));
}

function buildPrompt(word, gloss, level, count) {
  return [
    `You are a German teacher writing example sentences for a Persian-speaking learner at CEFR level ${level}.`,
    `Write exactly ${count} natural German example sentence(s) using the German word "${word}"${gloss ? ` (meaning: ${gloss})` : ''}.`,
    'Rules:',
    `- Each sentence must literally contain the word "${word}" in exactly this spelling (case-insensitive). For verbs use a construction with the infinitive if needed (e.g. "Ich muss gehen", "zu gehen"); for nouns use the given singular/plural form, not another form.`,
    `- Sentences must fit CEFR level ${level} vocabulary and grammar: short and simple for A1/A2, natural everyday German for B1, richer and more complex for B2/C1.`,
    '- Each sentence must show a different, realistic everyday use of the word.',
    '- Give a correct, natural Persian translation for every sentence.',
    'Answer with ONLY this JSON object, no other text:',
    '{"examples": [{"de": "...", "fa": "..."}]}',
  ].join('\n');
}

function parseExamples(text, word, count) {
  const m = (text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  let v;
  try { v = JSON.parse(m[0]); } catch { return null; }
  if (!Array.isArray(v.examples)) return null;
  const needle = String(word).toLowerCase();
  const out = [];
  for (const item of v.examples) {
    const de = typeof item?.de === 'string' ? item.de.trim() : '';
    const fa = typeof item?.fa === 'string' ? item.fa.trim() : '';
    // جمله باید خودِ کلمه را داشته باشد و ترجمه‌ی فارسی خالی نباشد؛ بقیه حذف می‌شوند
    if (!de || !fa) continue;
    if (!de.toLowerCase().includes(needle)) continue;
    if (!out.some((o) => o.de === de)) out.push({ de, fa });
    if (out.length >= count) break;
  }
  return out;
}

/**
 * @returns {Promise<{ok: boolean, examples: {de: string, fa: string}[]}>}
 */
export async function generateLevelExamples(word, gloss, level = 'B1', count = 3) {
  const w = String(word || '').trim();
  const lv = normalizeLevel(level);
  const n = clampCount(count);
  const fail = { ok: false, examples: [] };
  if (!w) return fail;

  const cacheKey = `ex:v1:${lv}:${w.toLowerCase()}:${n}`;
  const cached = await kv.getJSON(cacheKey).catch(() => null);
  if (cached?.examples?.length) return cached;

  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail;

  const body = JSON.stringify({
    contents: [{ parts: [{ text: buildPrompt(w, gloss, lv, n) }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
  });
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        signal: ctrl.signal,
        body,
      });
    } catch {
      res = null;
    } finally {
      clearTimeout(timer);
    }
    if (res?.ok) break;
    if (attempt === 0 && (res === null || res.status === 503 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    return fail;
  }
  try {
    if (!res?.ok) return fail;
    const data = await res.json().catch(() => null);
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const examples = parseExamples(text, w, n);
    if (!examples?.length) return fail;
    const result = { ok: true, examples };
    await kv.setJSON(cacheKey, result, 30 * 24 * 3600).catch(() => {});
    return result;
  } catch {
    return fail;
  }
}
