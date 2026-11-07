// German dictionary lookup
// منبع اصلی: ویکی‌واژه‌ی آلمانی (de.wiktionary.org) — آرتیکل (Genus)، جمع (Nominativ Plural)،
// نوع کلمه و توضیح آلمانی (Bedeutungen) از wikitext صفحه خوانده و پارس می‌شود.
// معنی فارسی: اول ترجمه‌ی فارسیِ خودِ مدخل ویکی‌واژه؛ MyMemory فقط پشتیبان است (با زنجیره‌ی de→en→fa).
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

  // توضیح آلمانی: همه‌ی معنی‌های بخش Bedeutungen (خواسته‌ی کاربر: تمامی معانی، سقف ۱۰)
  const meaningsRaw = section(wikitext, 'Bedeutungen');
  const definitions = [];
  for (const line of meaningsRaw.split('\n')) {
    const m = line.match(/^:\[(\d+)[a-z]?\]\s*(.+)$/);
    if (m) definitions.push(cleanWiki(m[2]).slice(0, 220));
    if (definitions.length >= 10) break;
  }

  // مثال کاربردی از بخش Beispiele — «کلمه کجا و چطور استفاده می‌شود»
  const examplesRaw = section(wikitext, 'Beispiele');
  const examples = [];
  for (const line of examplesRaw.split('\n')) {
    const m = line.match(/^:\[[\d,\s]+\]\s*(.+)$/);
    if (m) {
      const ex = cleanWiki(m[1]);
      if (ex.length > 3) examples.push(ex);
    }
    if (examples.length >= 2) break;
  }

  const ipa = wikitext.match(/\{\{Lautschrift\|([^}]+)\}\}/)?.[1] ?? null;

  return {
    word,
    wordType,
    article: genus ? ARTICLE[genus] : null,
    plural,
    definitions,
    examples,
    // ترجمه‌های خودِ مدخل ویکی‌واژه — منبع اصلی معنی (دقیق و بدون سهمیه)
    faTranslations: cleanFaItems(extractTranslations(wikitext, 'fa')),
    enTranslations: extractTranslations(wikitext, 'en'),
    ipa,
    found: Boolean(wordType || definitions.length),
  };
}

async function fetchWiktionary(candidate) {
  const url = 'https://de.wiktionary.org/w/api.php?action=parse&prop=wikitext&format=json&page='
    + encodeURIComponent(candidate);
  // تلاش مجدد با مکث افزاینده — محدودیت نرخ ویکی‌واژه نباید ما را به صفحه‌ی هم‌نام اشتباه بفرستد
  for (const delay of [0, 700, 1800]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const res = await fetch(url, { headers: UA }).catch(() => null);
    if (!res) continue;
    if (res.status === 429 || res.status >= 500) continue;
    if (!res.ok) return null; // صفحه وجود ندارد — تلاش مجدد فایده ندارد
    const data = await res.json().catch(() => null);
    const wikitext = data?.parse?.wikitext?.['*'];
    return wikitext ? { title: data.parse.title, wikitext } : null;
  }
  return null;
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
/** پاک‌کردن علائم نگارشیِ لبه‌ها (درس «Großmutter!» — علامت تعجب نباید جزو کلمه شود) */
const cleanCandidate = (s) => (s || '')
  .split(/[;,/]/)[0]
  .replace(/^[^\p{L}\p{M}]+|[^\p{L}\p{M}]+$/gu, '')
  .trim();

/**
 * مرتب‌سازی و پالایش معادل‌های MyMemory (تابع خالص — برای تست آفلاین export شده).
 * درسِ «سگ»: منبع گاهی عبارتِ چندکلمه‌ایِ نامربوط برمی‌گرداند (مثل «Du Hund» از دل یک جمله).
 * قانون‌ها:
 *  ۱) فقط معادلِ تک‌کلمه‌ای قبول است (بعد از پاک‌سازی علائم نگارشی).
 *  ۲) پیشنهادهایی که segment آن‌ها دقیقا خودِ کلمه‌ی کاربر است، اول می‌آیند (به ترتیب منبع).
 *  ۳) بعد ترجمه‌ی اصلی (اگر تک‌کلمه‌ای بود) و بقیه‌ی پیشنهادهای تک‌کلمه‌ای، به ترتیب منبع.
 */
export function orderEquivalents(word, main, matches = []) {
  const seen = new Set();
  const out = [];
  const push = (cand) => {
    const w = cleanCandidate(cand);
    const key = w.toLowerCase();
    if (w && singleToken(w) && !seen.has(key)) {
      seen.add(key);
      out.push(w);
    }
  };
  for (const m of matches) if (m.segment === word) push(m.translation);
  push(main);
  for (const m of matches) push(m.translation);
  if (!out.length) { const w = cleanCandidate(main); if (w) out.push(w); }
  return out.slice(0, 5);
}

// ---------- جست‌وجوی معکوس در ویکی‌واژه (منبع اصلی و دقیق معادل‌ها) ----------
// ایده: مدخل‌های آلمانی‌ای را پیدا می‌کنیم که در بخش «ترجمه‌ها»یشان خودِ کلمه‌ی فارسی آمده.
// این روش هم «Pferd» را برای اسب پیدا می‌کند، هم جلوی آشغال‌هایی مثل «Hauspferd» را می‌گیرد.

async function wikiApi(params) {
  const res = await fetch('https://de.wiktionary.org/w/api.php?' + new URLSearchParams({ format: 'json', ...params }), { headers: UA });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/**
 * ترجمه‌های یک مدخل به زبان داده‌شده را از بخش Übersetzungen بیرون می‌کشد (آرایه).
 * قالب‌های استاندارد: {{Ü|fa|سگ}} و {{Üt|fa|سگ|…}} + خط‌های مستقیم *{{fa}}: [[سگ]]
 */
function extractTranslations(wikitext, lang) {
  const idx = wikitext.indexOf('Übersetzungen');
  if (idx < 0) return [];
  let end = wikitext.indexOf('\n==', idx + 10);
  if (end < 0 || end > idx + 30000) end = Math.min(wikitext.length, idx + 30000);
  const sec = wikitext.slice(idx, end);
  const texts = [];
  // قالب «Üt?» با علامت سؤالِ واقعی هم هست ({{Üt?|fa|داشتن|dashtan}}) — هر سه شکل Ü و Üt و Üt?
  // همه‌ی شکل‌های قالب ترجمه: Ü و Üt و Üt? و Üxx4 و… (درس Haus: ‏{{Üxx4|fa|خانه}})
  const payloadRe = new RegExp(`\\{\\{Ü\\w*\\??\\|${lang}\\|([^}|]+)`, 'g');
  for (const m of sec.matchAll(payloadRe)) texts.push(m[1].trim());
  const lineRe = new RegExp(`\\{\\{${lang}\\}\\}`);
  for (const line of sec.split('\n')) {
    if (!lineRe.test(line) || /Ü\w*\??\|/.test(line)) continue;
    const plain = line
      .replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a)
      .replace(/\{\{[^}]*\}\}/g, ' ');
    if (lang === 'fa') {
      const fa = plain.match(/[\u0600-\u06FF][\u0600-\u06FF\u200c ]*/g);
      if (fa) texts.push(...fa.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean));
    } else {
      const t = plain.replace(/^[*:\s]+/, '').trim();
      if (t) texts.push(t);
    }
  }
  return [...new Set(texts.filter(Boolean))];
}

/**
 * ترجمه‌ی فارسی از ویکی‌واژه‌ی انگلیسی (en.wiktionary) — منبع قطعی و بدون سهمیه
 * برای کلمه‌هایی که مدخل آلمانی‌شان ترجمه‌ی فارسی ندارد (مثل gehen → رفتن).
 * فقط بخش آلمانیِ صفحه و فقط اولین ترجمه‌ی فارسیِ آن بخش خوانده می‌شود.
 */
async function fetchEnWiktionaryFa(word) {
  const url = 'https://en.wiktionary.org/w/api.php?action=parse&prop=wikitext&format=json&page='
    + encodeURIComponent(word);
  const res = await fetch(url, { headers: UA }).catch(() => null);
  if (!res || !res.ok) return null;
  const data = await res.json().catch(() => null);
  const wt = data?.parse?.wikitext?.['*'];
  if (!wt) return null;
  const start = wt.indexOf('==German==');
  if (start < 0) return null;
  // پایان بخش آلمانی = تیتر سطح‌دوِ بعدی (===های زیربخش جزو خود بخش‌اند)
  const rest = wt.slice(start);
  const next = rest.slice(10).search(/\n==[^=]/);
  const sec = next < 0 ? rest : rest.slice(0, next + 10);
  for (const line of sec.split('\n')) {
    if (!/Persian/.test(line)) continue;
    const m = line.match(/\{\{t\+?\|fa\|([^}|]+)/);
    if (m) {
      const cleaned = cleanFaItems([m[1]]);
      if (cleaned.length) return cleaned[0];
    }
  }
  return null;
}

/** متن ترجمه‌ی فارسی یک مدخل (برای جست‌وجوی معکوس) */
function extractFaTranslation(wikitext) {
  const arr = extractTranslations(wikitext, 'fa').filter((t) => /[\u0600-\u06FF]/.test(t));
  return arr.length ? arr.join('؛ ') : null;
}

/**
 * پالایش ترجمه‌های فارسیِ مدخل: حذف آشغال‌های قالب‌بندی (مثل ♪)، جمله‌های کامل و تکه‌های بی‌ربط.
 * (درس schnell: یک خط خراب «- تشنج. سریع.» داده بود.)
 */
function cleanFaItems(items) {
  const out = [];
  for (const raw of items || []) {
    const t = (raw || '')
      .replace(/[^\u0600-\u06FF\u200c\s]/g, ' ') // فقط حروف فارسی/عربی + نیم‌فاصله + فاصله
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length > 24 || /\p{P}/u.test(raw || '')) continue; // هر نوع علامت نگارشی = جمله/آشغال، نه ترجمه
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export async function findEquivalentsWiktionary(faWord) {
  const data = await wikiApi({
    action: 'query', list: 'search', srnamespace: '0', srlimit: '10', srsearch: faWord,
  }).catch(() => null);
  const titles = (data?.query?.search ?? [])
    .map((s) => s.title)
    .filter((t) => /^[A-ZÄÖÜ]/u.test(t) && !t.includes(' ') && !t.includes(':'));
  if (!titles.length) return [];
  const pages = await wikiApi({
    action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
    titles: titles.join('|'),
  }).catch(() => null);
  const byTitle = new Map();
  for (const p of Object.values(pages?.query?.pages ?? {})) {
    const wt = p.revisions?.[0]?.slots?.main?.['*'] ?? p.revisions?.[0]?.['*'];
    if (wt) byTitle.set(p.title, wt);
  }
  const tier1 = []; // ترجمه‌ی فارسیِ مدخل دقیقا خود کلمه است
  const tier2 = []; // کلمه جزئی از ترجمه‌ی فارسی است (مثل «گوشت سگ»)
  for (const t of titles) {
    const wt = byTitle.get(t);
    if (!wt) continue;
    const faText = extractFaTranslation(wt);
    if (!faText) continue;
    if (faText.split('؛').map((s) => s.trim()).includes(faWord)) tier1.push(t);
    else if (faText.split(/[\s؛،]+/).includes(faWord)) tier2.push(t);
  }
  // اگر معادل دقیق هست، سراغ جزئی‌ها نمی‌رویم (وگرنه «اسب» می‌شود «اسب بخار» و «گوشت اسب»!)
  const ordered = tier1.length ? tier1 : tier2;
  return ordered.slice(0, 5);
}

/**
 * معادل‌های آلمانی یک کلمه‌ی فارسی — به ترتیب رواج.
 * برای هر معادل، مدخل کامل آلمانی (آرتیکل/جمع) هم گرفته می‌شود.
 */
export async function lookupPersian(rawWord) {
  const word = String(rawWord || '').trim().split(/\s+/)[0];
  if (!word) return { found: false, word, equivalents: [] };
  const cacheKey = `fa2de:v2:${word}`;
  const cached = await kv.getJSON(cacheKey).catch(() => null);
  if (cached) return cached;

  // منبع اصلی: جست‌وجوی معکوس ویکی‌واژه (دقیق، بدون سهمیه) — پشتیبان: MyMemory پالایش‌شده
  let ordered = await findEquivalentsWiktionary(word).catch(() => []);
  let unavailable = false;
  if (!ordered.length) {
    const r = await myMemoryFull(word, 'fa', 'de').catch(() => null);
    if (!r) unavailable = true;
    else ordered = orderEquivalents(word, r.main, r.matches);
  }
  const equivalents = [];
  for (const de of ordered) {
    const entry = await lookupGerman(de).catch(() => null);
    // اگر مدخل پیدا شد ولی مال کلمه‌ی دیگری بود، تزئیناتش را نشان نده
    const ok = entry?.found && entry.word.toLowerCase() === de.toLowerCase();
    equivalents.push({ de, entry: ok ? entry : null });
  }
  // مفهوم انگلیسی برای ساخت تصویرِ درست (عکسِ «سگ» باید سگ باشد، نه معادل اشتباه)
  const englishConcept = equivalents[0]?.entry?.english
    || await myMemory(word, 'fa', 'en').catch(() => null);
  const result = { found: equivalents.length > 0, word, equivalents, englishConcept, unavailable };
  if (result.found) await kv.setJSON(cacheKey, result, 7 * 24 * 3600).catch(() => {});
  return result;
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

/** ترجمه‌ی فارسیِ سالم از MyMemory: کوتاه، بدون جمله و علامت نگارشی (درس «- تشنج. سریع.») */
const saneFa = (t) => (t && hasPersianScript(t) && t.trim().length <= 30
  && !/[.!?؟…]/.test(t) && !t.trim().startsWith('-')) ? t.trim() : null;

export async function translateToPersian(word) {
  const direct = saneFa(await myMemory(word, 'de', 'fa').catch(() => null));
  if (direct) return direct;
  // زنجیره: آلمانی -> انگلیسی -> فارسی
  const en = await myMemory(word, 'de', 'en').catch(() => null);
  if (en) {
    const fa = saneFa(await myMemory(en, 'en', 'fa').catch(() => null));
    if (fa) return fa;
  }
  return null;
}

const isMasdarFa = (s) => /(تن|دن)$/.test((s || '').trim());

/**
 * ترجمه‌ی فارسیِ فعل وقتی خودِ ویکی‌واژه ترجمه‌ی فارسی ندارد (مثل gehen):
 * بین همه‌ی پیشنهادهای MyMemory اول مصدر (…تن/…دن) انتخاب می‌شود، نه صرف‌شده یا اسمی
 * (درس‌ها: gehen شد «پیاده‌روی» و haben شد «دارند» درحالی‌که درستش «رفتن» و «داشتن» است).
 */
async function translateVerbToPersian(word, enGlosses = []) {
  const r = await myMemoryFull(word, 'de', 'fa').catch(() => null);
  const direct = (r ? [r.main, ...(r.matches || []).map((m) => m.translation)] : [])
    .map(saneFa).filter(Boolean);
  const masdar = direct.find(isMasdarFa);
  if (masdar) return masdar;
  // زنجیره از برگردان‌های انگلیسیِ خودِ مدخل: هر gloss هم با «to» و هم بدون آن پرسیده می‌شود،
  // چون MyMemory برای «to go» مصدر «رفتن» می‌دهد ولی برای «go» امریِ «برو»!
  let glosses = (enGlosses || [])
    .flatMap((t) => String(t).split(/[,;]/).map((s) => s.trim().replace(/^to\s+/i, '')))
    .filter((t) => t && t.length <= 20 && /^[a-zA-Z ]+$/.test(t));
  if (!glosses.length) {
    const ren = await myMemoryFull(word, 'de', 'en').catch(() => null);
    glosses = [ren?.main, ...(ren?.matches || []).map((m) => m.translation)]
      .filter(Boolean)
      .flatMap((t) => t.split(/[,;]/).map((s) => s.trim().replace(/^to\s+/i, '')))
      .filter((t) => t && t.length <= 20 && /^[a-zA-Z ]+$/.test(t));
  }
  // glossهای کوتاه‌تر اول: فعل پایه معمولا کوتاه است (go قبل از walk → رفتن، نه راه رفتن)
  for (const g of [...new Set(glosses)].sort((a, b) => a.length - b.length).slice(0, 4)) {
    for (const q of [`to ${g}`, g]) {
      const r2 = await myMemoryFull(q, 'en', 'fa').catch(() => null);
      const via = (r2 ? [r2.main, ...(r2.matches || []).map((m) => m.translation)] : [])
        .map(saneFa).filter(Boolean);
      const m2 = via.find(isMasdarFa);
      if (m2) return m2;
    }
  }
  return direct[0] || null;
}

/**
 * جست‌وجوی کامل یک کلمه.
 * @returns {Promise<{word, wordType, article, plural, definitions, ipa, persian, found}>}
 */
export async function lookupGerman(rawWord) {
  const word = String(rawWord || '').trim().split(/\s+/)[0];
  if (!word) return { found: false, word: '' };

  const cacheKey = `dict:v5:${word.toLowerCase()}`;
  const cached = await kv.getJSON(cacheKey).catch(() => null);
  if (cached) return cached;

  // اسم‌ها در آلمانی با حرف بزرگ شروع می‌شوند؛ هر سه حالت امتحان می‌شود.
  const candidates = [...new Set([
    word,
    word.charAt(0).toUpperCase() + word.slice(1),
    word.charAt(0).toLowerCase() + word.slice(1),
  ])];

  // بین صفحات هم‌نام، مدخل اصلی (اسم/فعل/صفت…) بر صفحه‌های صرفی (Konjugierte Form و…) مقدم است.
  // (درس Liebe: یک خطای لحظه‌ای در واکشی، صفحه‌ی صرفیِ liebe را جلو انداخته بود.)
  const FORM_TYPE = /^(Konjugierte|Deklinierte|Abkürzung|Buchstabe|Silbe|Toponym|Vorname|Nachname)/;
  let entry = { found: false, word };
  let formEntry = null;
  for (const c of candidates) {
    const page = await fetchWiktionary(c).catch(() => null);
    if (page) {
      const parsed = parseEntry(page.title, page.wikitext);
      if (parsed.found) {
        if (!FORM_TYPE.test(parsed.wordType || '')) { entry = parsed; break; }
        formEntry = formEntry || parsed;
      }
    }
  }
  if (!entry.found && formEntry) entry = formEntry;
  if (!entry.found) return entry;

  // معنی فارسی: اول ترجمه‌ی خودِ ویکی‌واژه (دقیق)؛ MyMemory فقط پشتیبان است
  // (درس machen: ‏MyMemory‏ «داشتن» و «beat» می‌داد، ولی ویکی‌واژه «کردن» و «make, do» دارد)
  if (entry.faTranslations?.length) {
    const items = entry.faTranslations.slice(0, 3);
    // برای فعل‌ها مصدر اول بیاید. مصدر فارسی به «تن» یا «دن» تمام می‌شود:
    // داشتن قبل از دارند، رفتن قبل از پیاده‌روی، کردن قبل از کن
    // (باگ قبلی: فقط «دن» چک می‌شد و مصدرهای «تن»دار مثل داشتن/رفتن جا می‌ماندند)
    if (entry.wordType === 'Verb') {
      const isMasdar = (s) => /(تن|دن)$/.test(s);
      // مصدر اول؛ بین مصدرها کوتاه‌تر اول (مصدر پایه: دویدن قبل از لیز خوردن، کردن قبل از انجام دادن)
      items.sort((a, b) => (isMasdar(b) ? 1 : 0) - (isMasdar(a) ? 1 : 0) || a.length - b.length);
    }
    entry.persian = items.join('، ');
  } else {
    // مدخل آلمانی ترجمه‌ی فارسی ندارد. ترتیب: اول زنجیره‌ی مصدر/ترجمه، و
    // ویکی‌واژه‌ی انگلیسی فقط پشتیبانِ آخر است (برای Haus اول ساختمان می‌داد، نه خانه!)
    entry.persian = entry.wordType === 'Verb'
      // فعل: باز هم مصدر، نه صرف‌شده (gehen → رفتن)
      ? await translateVerbToPersian(entry.word, entry.enTranslations).catch(() => null)
        ?? await translateToPersian(entry.word).catch(() => null)
      : await translateToPersian(entry.word).catch(() => null);
    if (!entry.persian) {
      entry.persian = await fetchEnWiktionaryFa(entry.word).catch(() => null);
    }
  }
  // تصویر واقعی از ویکی‌واژه + برگردان انگلیسی از خود مدخل (برای ساخت تصویر)
  entry.image = await fetchWikiImage(entry.word).catch(() => null);
  entry.english = entry.enTranslations?.length
    ? entry.enTranslations.slice(0, 3).join(', ')
    : await translateToEnglish(entry.word).catch(() => null);
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
  // تمامی معادل‌های فارسیِ مدخل (نه فقط اولی)
  if (e.faTranslations?.length > 1) {
    lines.push('', `🇮🇷 معادل‌های فارسی: ${e.faTranslations.slice(0, 8).join('، ')}`);
  } else {
    lines.push('', `🇮🇷 معنی فارسی: ${e.persian || 'یافت نشد'}`);
  }
  if (e.examples?.length) {
    lines.push('');
    e.examples.slice(0, 2).forEach((ex) => lines.push(`📝 مثال: ${ex}`));
  }
  return lines.join('\n');
}
