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

async function myMemory(q, from, to) {
  const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(q)
    + `&langpair=${from}%7C${to}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const t = data?.responseData?.translatedText
    ?.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  return t && t.toLowerCase() !== q.toLowerCase() ? t : null;
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

  const cacheKey = `dict:${word.toLowerCase()}`;
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
    lines.push(`🔤 جمع: ${e.plural ? `die ${e.plural.replace(/^die\s+/, '')}` : '—'}`);
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
