// ترجمه‌ی حرفه‌ای متن (جمله و پاراگراف) — موتورها به ترتیب کیفیت:
// ۱) DeepL — اگر کلید API در متغیر محیطی DEEPL_API_KEY باشد (استاندارد طلایی آلمانی، فارسی را هم دارد)
// ۲) Google Translate ‏(GTX) — تلاش فرصت‌طلبانه؛ از بعضی IPها بسته است، خروجی‌اش سخت اعتبارسنجی می‌شود
// ۳) MyMemory جمله‌به‌جمله — پشتیبان همیشه‌در‌دسترس (با همان پالایش‌های ضدآشغال دیکشنری)
// هر تکه (chunk) در Redis کش می‌شود تا متن‌های تکراری رایگان و فوری باشند.

import { createHash } from 'node:crypto';
import { kv } from './store.js';

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BaleGermanBot/1.0' };
export const MAX_TEXT_CHARS = 2000;
const hasFa = (s) => /[\u0600-\u06FF]/.test(s || '');

/** جهت خودکار: متن فارسی → آلمانی، وگرنه آلمانی → فارسی */
export const detectDirection = (text) => (hasFa(text) ? ['fa', 'de'] : ['de', 'fa']);

/** تقسیم متن به جمله‌ها و تکه‌های حداکثر ۴۰۰ کاراکتری (با حفظ علائم پایانی) */
export function splitChunks(text) {
  const normalized = String(text || '').replace(/\s+\n/g, '\n').trim();
  const sentences = normalized.match(/[^.!?؟…\n]+[.!?؟…]*\s*/g) || [normalized];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > 400 && cur) { chunks.push(cur.trim()); cur = ''; }
    if (s.length > 400) { // جمله‌ی خیلی بلند: برش در مرز کلمه
      for (let i = 0; i < s.length; i += 400) chunks.push(s.slice(i, i + 400).trim());
    } else {
      cur += s;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

async function deeplTranslate(text, from, to) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) return null;
  const host = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await fetch(`${host}/v2/translate`, {
    method: 'POST',
    headers: { 'Authorization': `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: [text],
      source_lang: from.toUpperCase(),
      target_lang: to.toUpperCase(),
    }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  const out = data?.translations?.[0]?.text?.trim();
  return out || null;
}

async function gtxTranslate(chunk, from, to) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t'
    + `&sl=${from}&tl=${to}&q=` + encodeURIComponent(chunk);
  const res = await fetch(url, { headers: UA }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null); // صفحه‌ی مسدودی HTML است و این‌جا رد می‌شود
  if (!Array.isArray(data?.[0])) return null;
  const out = data[0].map((seg) => seg?.[0] || '').join('').trim();
  if (!out || out === chunk) return null;
  if (to === 'fa' && !hasFa(out)) return null;
  return out;
}

async function myMemoryChunk(chunk, from, to) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(chunk)
    + `&langpair=${from}%7C${to}`;
  const res = await fetch(url, { headers: UA }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  const out = data?.responseData?.translatedText
    ?.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
  if (!out || /MYMEMORY WARNING|AVAILABLE FREE TRANSLATIONS/i.test(out)) return null;
  if (to === 'fa' && !hasFa(out)) return null;
  return out;
}

async function translateChunk(chunk, from, to) {
  const cacheKey = 'txt:v1:' + createHash('sha1').update(`${from}|${to}|${chunk}`).digest('hex');
  const cached = await kv.getJSON(cacheKey).catch(() => null);
  if (cached?.text) return cached;
  const out = await gtxTranslate(chunk, from, to)
    || await myMemoryChunk(chunk, from, to);
  if (out) {
    const engine = 'متن';
    await kv.setJSON(cacheKey, { text: out }, 30 * 24 * 3600).catch(() => {});
    return { text: out, engine };
  }
  return { text: chunk, engine: null, failed: true };
}

/**
 * ترجمه‌ی کامل متن. خروجی: { text, engine, failed }
 * engine برای شفافیت به کاربر نشان داده می‌شود (DeepL / گوگل / …).
 */
export async function translateText(rawText, from, to) {
  const text = String(rawText || '').trim().slice(0, MAX_TEXT_CHARS);
  if (!text) return { text: '', engine: null, failed: true };

  const viaDeepl = await deeplTranslate(text, from, to).catch(() => null);
  if (viaDeepl) return { text: viaDeepl, engine: 'DeepL', failed: false };

  const chunks = splitChunks(text);
  const results = [];
  for (let i = 0; i < chunks.length; i += 4) { // دسته‌های ۴تایی موازی
    results.push(...await Promise.all(
      chunks.slice(i, i + 4).map((c) => translateChunk(c, from, to))));
  }
  const failed = results.some((r) => r.failed);
  return {
    text: results.map((r) => r.text).join(' '),
    engine: failed ? null : 'ترجمه ماشینی',
    failed,
  };
}
