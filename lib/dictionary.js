// German dictionary lookup
// منبع اصلی: ویکی‌واژه‌ی آلمانی (de.wiktionary.org) — آرتیکل (Genus)، جمع (Nominativ Plural)،
// نوع کلمه و توضیح آلمانی (Bedeutungen) از wikitext صفحه خوانده و پارس می‌شود.
// معنی فارسی: MyMemory (de→fa)؛ اگر خروجی فارسی نبود، زنجیره‌ی de→en→fa امتحان می‌شود.
// همه‌ی منابع رایگان و بدون کلید هستند. نتیجه ۳۰ روز کش می‌شود.

import { kv } from './store.js';

const UA = { 'user-agent': 'BaleGermanDictionaryBot/1.0 (educational dictionary bot)' };
const ARTICLE = { m: 'der', f: 'die', n: 'das' };

/** پاک‌سازی wikitext برای نمایش به کاربر */
export function cleanWiki(text = '') {
  return text
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '')                       // تگ‌های HTML مثل <sub>
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\{\{[^{}]*\}\}/g, '')               // قالب‌ها {{...}}
    .replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, '$2') // [[a|b]] -> b
    .replace(/\[\[([^\]]+)\]\]/g, '$1')            // [[a]] -> a
    .replace(/'{2,3}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function section(wikitext, title) {
  // بخش‌هایی مثل {{Bedeutungen}} تا قالبِ بخش بعدی
  const re = new RegExp(`\\{\\{${title}\\}\\}([\\s\\S]*?)(?=\\n\\{\\{|\\n===|$)`);
  const m = wikitext.match(re);
  return m ? m[1] : '';
}

function parseEntry(word, wikitext) {
  const typeMatch = wikitext.match(/\{\{Wortart\|([^| }]+)/);
  const wordType = typeMatch ? typeMatch[1] : null; // Substantiv | Verb | Adjektiv | ...

  // جدول صرف اسم: {{Deutsch Substantiv Übersicht |Genus=n |Nominativ Plural=Häuser ...}}
  const overview = wikitext.match(/\{\{Deutsch Substantiv Übersicht([\s\S]*?)\}\}/);
  let genus = null, plural = null;
  if (overview) {
    genus = overview[1].match(/\|Genus=([mfn])/)?.[1] ?? null;
    // بعضی اسم‌ها چند جمع دارند: Nominativ Plural 1 / Plural 2 (مثل Wasser / Wässer)
    const pls = [...overview[1].matchAll(/\|Nominativ Plural(?: \d+)?=([^\n|]+)/g)]
      .map((m) => cleanWiki(m[1].trim())).filter((p) => p && p !== '-');
    if (pls.length) plural = [...new Set(pls)].join(' / ');
    if (/kein Plural/i.test(overview[1])) plural = '— (بدون جمع)';
  }
  if (!genus) {
    // جایگزین: {{Wortart|Substantiv|Deutsch}}, {{f}}
    genus = wikitext.match(/\{\{Wortart\|Substantiv[^}]*\}\},\s*\{\{([mfn])\}\}/)?.[1] ?? null;
  }
  if (!plural) {
    const pl = wikitext.match(/\|Plural[^=]*=\s*([^\n|}]+)/)?.[1];
    if (pl) plural = cleanWiki(pl);
  }

  // توضیح آلمانی: اولین ۳ معنی از بخش Bedeutungen
  const meaningsRaw = section(wikitext, 'Bedeutungen');
  const definitions = [];
  for (const line of meaningsRaw.split('\n')) {
    const m = line.match(/^:\[(\d+)\]\s*(.+)$/);
    if (m) definitions.push(cleanWiki(m[2]));
    if (definitions.length >= 3) break;
  }

  const ipa = wikitext.match(/\{\{Lautschrift\|([^}]+)\}\}/)?.[1] ?? null;

  return {
    word,
    wordType,
    article: genus ? ARTICLE[genus] : null,
    plural,
    definitions,
    ipa,
    found: Boolean(wordType || definitions.length),
  };
}

async function fetchWiktionary(candidate) {
  const url = 'https://de.wiktionary.org/w/api.php?action=parse&prop=wikitext&format=json&page='
    + encodeURIComponent(candidate);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const wikitext = data?.parse?.wikitext?.['*'];
  return wikitext ? { title: data.parse.title, wikitext } : null;
}

const hasPersianScript = (s) => /[\u0600-\u06FF]/.test(s || '');

const cleanTranslation = (t) => t
  ?.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();

async function myMemoryFull(q, from, to) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q)
    + `&langpair=${from}%7C${to}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const main = cleanTranslation(data?.responseData?.translatedText);
  // وقتی سهمیه‌ی رایگان تمام می‌شود، MyMemory به‌جای ترجمه متن هشدار برمی‌گرداند!
  if (!main || /MYMEMORY WARNING|AVAILABLE FREE TRANSLATIONS/i.test(main)) return null;
  const matches = (data?.matches ?? [])
    .map((m) => ({
      translation: cleanTranslation(m.translation),
      segment: (m.segment || '').trim(),
    }))
    .filter((m) => m.translation);
  return { main, matches };
}

async function myMemory(q, from, to) {
  const r = await myMemoryFull(q, from, to).catch(() => null);
  const t = r?.main;
  return t && t.toLowerCase() !== q.toLowerCase() ? t : null;
}

export const translateToEnglish = (word) => myMemory(word, 'de', 'en');

/** تصویر واقعی کلمه از خود مدخل ویکی‌واژه (ویکیمدیا) — اگر داشته باشد */
async function fetchWikiImage(title) {
  const url = 'https://de.wiktionary.org/w/api.php?action=query&prop=pageimages&piprop=original&format=json&titles='
    + encodeURIComponent(title);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const page = Object.values(data?.query?.pages ?? {})[0];
  const src = page?.original?.source;
  return src ? src.split('?')[0] : null;
}

const singleToken = (s) => /^[\p{L}\p{M}'’-]+$/u.test(s || '');

/**
 * مرتب‌سازی و پالایش معادل‌ها (تابع خالص — برای تست آفلاین export شده).
 * درسِ «سگ»: منبع گاهی عبارتِ چندکلمه‌ایِ نامربوط برمی‌گرداند (مثل «Du Hund» از دل یک جمله).
 * قانون‌ها:
 *  ۱) فقط معادلِ تک‌کلمه‌ای قبول است.
 *  ۲) پیشنهادهایی که segment آن‌ها دقیقا خودِ کلمه‌ی کاربر است، اول می‌آیند (به ترتیب منبع).
 *  ۳) بعد ترجمه‌ی اصلی (اگر تک‌کلمه‌ای بود) و بقیه‌ی پیشنهادهای تک‌کلمه‌ای، به ترتیب منبع.
 */
export function orderEquivalents(word, main, matches = []) {
  const seen = new Set();
  const out = [];
  const push = (cand) => {
    const w = (cand || '').split(/[;,/]/)[0].trim();
    const key = w.toLowerCase();
    if (w && singleToken(w) && !seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  };
  for (const m of matches) if (m.segment === word) push(m.translation);
  push(main);
  for (const m of matches) push(m.translation);
  if (!out.length && main) out.push(main.split(/[;,/]/)[0].trim());
  return out.slice(0, 5);
}

/**
 * معادل‌های آلمانی یک کلمه‌ی فارسی — به ترتیب رواج.
 * برای هر معادل، مدخل کامل آلمانی (آرتیکل/جمع) هم گرفته می‌شود.
 */
export async function lookupPersian(rawWord) {
  const word = String(rawWord || '').trim().split(/\s+/)[0];
  if (!word) return { found: false, word, equivalents: [] };
  const r = await myMemoryFull(word, 'fa', 'de').catch(() => null);
  if (!r) return { found: false, word, equivalents: [], unavailable: true };
  const ordered = orderEquivalents(word, r.main, r.matches);
  const equivalents = [];
  for (const de of ordered) {
    const entry = await lookupGerman(de).catch(() => null);
    // اگر مدخل پیدا شد ولی مال کلمه‌ی دیگری بود، تزئیناتش را نشان نده
    const ok = entry?.found && entry.word.toLowerCase() === de.toLowerCase();
    equivalents.push({ de, entry: ok ? entry : null });
  }
  // مفهوم انگلیسی برای ساخت تصویرِ درست (عکسِ «سگ» باید سگ باشد، نه معادل اشتباه)
  const englishConcept = await myMemory(word, 'fa', 'en').catch(() => null);
  return { found: equivalents.length > 0, word, equivalents, englishConcept };
}

/** متن نمایشی جمع: «die Hunde» یا «ندارد» — هیچ‌وقت «die —» چاپ نمی‌شود */
export const pluralText = (e) => {
  if (!e?.plural) return null;
  if (/^[—–-]\s*(\(بدون جمع\))?$/.test(e.plural.trim())) return 'ندارد';
  if (e.plural.includes('بدون جمع')) return 'ندارد';
  return `die ${e.plural.replace(/^die\s+/, '')}`;
};

export function formatPersianResult(r) {
  if (!r.found) {
    return r.unavailable
      ? '⚠️ سرویس ترجمه در حال حاضر در دسترس نیست. چند دقیقه دیگر دوباره تلاش کنید.'
      : `❌ برای «${r.word}» معادل آلمانی پیدا نشد.`;
  }
  const lines = [`🇮🇷 ${r.word}`, '', '🇩🇪 معادل‌های آلمانی (به ترتیب رواج):', ''];
  r.equivalents.forEach((eq, i) => {
    const e = eq.entry;
    let line = `${i + 1}. ${e?.article ? e.article + ' ' : ''}${eq.de}`;
    const pl = pluralText(e);
    if (pl) line += ` — جمع: ${pl}`;
    if (e?.persian) line += `\n    (${e.persian})`;
    lines.push(line);
  });
  return lines.join('\n');
}

export async function translateToPersian(word) {
  const direct = await myMemory(word, 'de', 'fa').catch(() => null);
  if (direct && hasPersianScript(direct)) return direct;
  // زنجیره: آلمانی -> انگلیسی -> فارسی
  const en = await myMemory(word, 'de', 'en').catch(() => null);
  if (en) {
    const fa = await myMemory(en, 'en', 'fa').catch(() => null);
    if (fa && hasPersianScript(fa)) return fa;
  }
  return direct || null;
}

/**
 * جست‌وجوی کامل یک کلمه.
 * @returns {Promise<{word, wordType, article, plural, definitions, ipa, persian, found}>}
 */
export async function lookupGerman(rawWord) {
  const word = String(rawWord || '').trim().split(/\s+/)[0];
  if (!word) return { found: false, word: '' };

  const cacheKey = `dict:v2:${word.toLowerCase()}`;
  const cached = await kv.getJSON(cacheKey).catch(() => null);
  if (cached) return cached;

  // اسم‌ها در آلمانی با حرف بزرگ شروع می‌شوند؛ هر سه حالت امتحان می‌شود.
  const candidates = [...new Set([
    word,
    word.charAt(0).toUpperCase() + word.slice(1),
    word.charAt(0).toLowerCase() + word.slice(1),
  ])];

  let entry = { found: false, word };
  for (const c of candidates) {
    const page = await fetchWiktionary(c).catch(() => null);
    if (page) {
      const parsed = parseEntry(page.title, page.wikitext);
      if (parsed.found) { entry = parsed; break; }
    }
  }
  if (!entry.found) return entry;

  entry.persian = await translateToPersian(entry.word).catch(() => null);
  // تصویر واقعی از ویکی‌واژه + برگردان انگلیسی (برای ساخت تصویر وقتی عکس واقعی نیست)
  entry.image = await fetchWikiImage(entry.word).catch(() => null);
  entry.english = await translateToEnglish(entry.word).catch(() => null);
  await kv.setJSON(cacheKey, entry, 30 * 24 * 3600).catch(() => {});
  return entry;
}

/** قالب پیام دیکشنری برای کاربر — دقیقا به ترتیبی که خواسته شده */
export function formatEntry(e) {
  if (!e.found) {
    return `❌ کلمه‌ی «${e.word}» پیدا نشد.\nاملای آلمانی را بررسی کنید؛ اسم‌ها را با حرف بزرگ بنویسید (مثل Haus).`;
  }
  const lines = [];
  lines.push(e.article ? `🇩🇪 ${e.article} ${e.word}` : `🇩🇪 ${e.word}`);
  if (e.ipa) lines.push(`🔊 /${e.ipa}/`);
  if (e.wordType === 'Substantiv') {
    lines.push(`🔤 جمع: ${pluralText(e) || '—'}`);
  } else if (e.wordType) {
    const fa = { Verb: 'فعل', Adjektiv: 'صفت', Adverb: 'قید', Präposition: 'حرف اضافه', Pronomen: 'ضمیر', Konjunktion: 'حرف ربط' }[e.wordType];
    lines.push(`🏷 نوع کلمه: ${e.wordType}${fa ? ` (${fa})` : ''}`);
  }
  if (e.definitions?.length) {
    lines.push('', '📖 توضیح به آلمانی:');
    e.definitions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
  }
  lines.push('', `🇮🇷 معنی فارسی: ${e.persian || 'یافت نشد'}`);
  return lines.join('\n');
}
