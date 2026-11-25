// German dictionary lookup
// منبع اصلی: ویکی‌واژه‌ی آلمانی (de.wiktionary.org) — آرتیکل (Genus)، جمع (Nominativ Plural)،
// نوع کلمه و توضیح آلمانی (Bedeutungen) از wikitext صفحه خوانده و پارس می‌شود.
// معنی فارسی: اول ترجمه‌ی فارسیِ خودِ مدخل ویکی‌واژه؛ MyMemory فقط پشتیبان است (با زنجیره‌ی de→en→fa).
// همه‌ی منابع رایگان و بدون کلید هستند. نتیجه ۳۰ روز کش می‌شود.

import { kv } from './store.js';
import { fetchDwds } from './dwds.js';

const UA = { 'user-agent': 'BaleGermanDictionaryBot/1.0 (educational dictionary bot)' };
const ARTICLE = { m: 'der', f: 'die', n: 'das' };

// نوع‌های صفحه‌ی صرفی/فرعی (نه مدخل اصلی): Konjugierte Form، Deklinierte Form و…
// هم در انتخاب مدخل اصلی و هم در نگهبانیِ کش استفاده می‌شود — پس بالای ماژول تعریف شده.
const FORM_TYPE = /^(Konjugierte|Deklinierte|Abkürzung|Buchstabe|Silbe|Toponym|Vorname|Nachname)/;

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

const FORM_BASE_NOUNS = '(?:Verbs|Substantivs|Adjektivs|Adverbs|Pronomens|Artikels|Numerales|Partizips|Infinitivs)';

function cleanFormToken(raw = '') {
  return cleanWiki(String(raw || '')).trim();
}

/** Grundform einer Formseite (z. B. ging → gehen) — fail-open, ohne erfundene Formen. */
function extractFormBase(wikitext = '') {
  try {
    const tpl = String(wikitext || '').match(/\{\{Grundformverweis[^{}]*\}\}/);
    if (tpl) {
      const parts = tpl[0].slice(2, -2).split('|').map((s) => s.trim());
      for (const part of parts.slice(1)) {
        if (!part) continue;
        const named = part.match(/^1\s*=\s*(.+)$/);
        const value = named ? named[1] : (part.includes('=') ? null : part);
        if (value) {
          const base = cleanFormToken(value);
          if (base) return base;
        }
      }
    }
    const linked = String(wikitext || '').match(new RegExp(
      `des\\s+${FORM_BASE_NOUNS}\\b[^\\n]{0,40}?\\[\\[([^\\]|]+)(?:\\|[^\\]]+)?\\]\\]`, 'i'));
    if (linked) return cleanFormToken(linked[1]);
    const plain = String(wikitext || '').match(new RegExp(
      `Grammatische Merkmale[\\s\\S]{0,1200}?des\\s+${FORM_BASE_NOUNS}\\s+([A-ZÄÖÜa-zäöüß][^\\s.,;:)]*)`, 'i'));
    if (plain) return cleanFormToken(plain[1]);
  } catch { /* fail-open */ }
  return null;
}

/** Erste Grammatik-Zeile einer Formseite, ohne den nachfolgenden „des Verbs …“-Teil. */
function extractFormGrammar(wikitext = '') {
  try {
    const text = String(wikitext || '');
    const idx = text.search(/Grammatische Merkmale/);
    if (idx < 0) return null;
    const scope = text.slice(idx, idx + 3000);
    for (const line of scope.split('\n')) {
      const bullet = line.match(/^\s*(?:[*:\-•]+)\s*(.+)$/);
      if (!bullet) continue;
      let grammar = cleanWiki(bullet[1]);
      if (!grammar) continue;
      grammar = grammar
        .replace(new RegExp(`\\s+des\\s+${FORM_BASE_NOUNS}\\b.*$`, 'i'), '')
        .replace(/[.;:]$/, '')
        .trim();
      if (grammar) return grammar.slice(0, 160);
    }
  } catch { /* fail-open */ }
  return null;
}

function parseEntry(word, wikitext) {
  // فقط بخش آلمانی صفحه خوانده می‌شود: ویکی‌واژه برای خیلی از املاها مدخل زبان‌های دیگر هم دارد
  // (family یک مدخل «انگلیسی» است: جمع families و مثال "I miss my family") — کلمه‌ی آلمانی نیست.
  const deHead = wikitext.search(/==[^=\n]*\{\{Sprache\|Deutsch\}\}/);
  if (deHead < 0) return { found: false, word };
  const headEnd = wikitext.indexOf('\n', deHead);
  const rest = wikitext.slice(headEnd);
  const nextLang = rest.search(/\n==[^=\n]*\{\{Sprache\|(?!Deutsch\}\})/);
  wikitext = nextLang >= 0 ? wikitext.slice(0, headEnd + nextLang) : wikitext.slice(deHead);

  const typeMatch = wikitext.match(/\{\{Wortart\|([^| }]+)/);
  const wordType = typeMatch ? typeMatch[1] : null; // Substantiv | Verb | Adjektiv | ...

  // بلوک مدخل اصلی: از اول صفحه تا {{Wortart}} دوم — صفحات چندمدخلی (مثل Haus) نباید
  // مترادف/متضاد/تعریفِ مدخل هم‌نام دیگر را قرض بگیرند.
  const secondTypeIdx = wikitext.indexOf('{{Wortart|', (typeMatch?.index ?? 0) + 10);
  const mainBlock = secondTypeIdx > 0 ? wikitext.slice(0, secondTypeIdx) : wikitext;
  const formBase = extractFormBase(mainBlock);
  const formGrammar = extractFormGrammar(mainBlock);

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

  // توضیح آلمانی: همه‌ی معنی‌های بخش Bedeutungen (خواسته‌ی کاربر: تمامی معانی، بدون سقف)
  const meaningsRaw = section(mainBlock, 'Bedeutungen');
  const definitions = [];
  for (const line of meaningsRaw.split('\n')) {
    const m = line.match(/^:\[(\d+)[a-z]?\]\s*(.+)$/);
    if (m) definitions.push(cleanWiki(m[2]).slice(0, 220));
  }

  // مثال کاربردی از بخش Beispiele — «کلمه کجا و چطور استفاده می‌شود»
  const examplesRaw = section(mainBlock, 'Beispiele');
  const examples = [];
  for (const line of examplesRaw.split('\n')) {
    const m = line.match(/^:\[[\d,\s]+\]\s*(.+)$/);
    if (m) {
      const ex = cleanWiki(m[1]);
      if (ex.length > 3) examples.push(ex);
    }
    if (examples.length >= 6) break;
  }

  // مترادف‌ها و متضادها از بخش‌های Synonyme / Gegenwörter مدخل اصلی
  const REGISTER = /^(salopp|umgangssprachlich|gehoben|abwertend|bildungssprachlich|fachsprachlich|regional|veraltet|scherzhaft|ironisch|pejorativ|euphemistisch|kindersprache|jugendsprachlich)$/i;
  const wordList = (title) => {
    const raw = section(mainBlock, title);
    const words = [];
    for (const line of raw.split('\n')) {
      // فقط خط‌های معنی‌های اصلی (اولین شماره‌ی برچسب ≤ ۳) یا بدون برچسب —
      // متضادِ معنی چهاردهمِ تخصصی (مثل Haus در معدن‌کاری) زبان‌آموز را گمراه می‌کند.
      const senseM = line.match(/^:\[([\d,\s–-]+)\]/);
      if (senseM) {
        const firstSense = parseInt(senseM[1].split(/[,\s]/)[0], 10);
        if (!(firstSense >= 1 && firstSense <= 3)) continue;
      }
      const m = line.match(/^:\[[\d,\s–-]+\]\s*(.+)$/) || line.match(/^:\s*(.+)$/);
      if (!m) continue;
      for (const part of cleanWiki(m[1]).split(/[,;]/)) {
        const w = part.replace(/\(.*?\)/g, '').trim();
        // برچسب‌های لحن (salopp: …) و قطعه‌های دارای دونقطه، کلمه نیستند
        if (!w || w.length > 30 || w.includes(':') || REGISTER.test(w)) continue;
        if (!words.includes(w)) words.push(w);
      }
      if (words.length >= 6) break;
    }
    return words.slice(0, 6);
  };

  const ipa = wikitext.match(/\{\{Lautschrift\|([^}]+)\}\}/)?.[1] ?? null;

  return {
    word,
    wordType,
    formBase,
    formGrammar,
    article: genus ? ARTICLE[genus] : null,
    plural,
    definitions,
    examples,
    synonyms: wordList('Synonyme'),
    antonyms: wordList('Gegenwörter'),
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
  // تلاش مجدد با مکث افزاینده — محدودیت نرخ ویکی‌واژه نباید ما را به صفحه‌ی هم‌نام اشتباه بفرستد.
  // خطای گذرا (429/5xx/شبکه) از «صفحه نیست» جداست و با { transient: true } برگردانده می‌شود.
  let waitMs = 0;
  for (const delay of [0, 700, 1800, 4000]) {
    const pause = Math.max(delay, waitMs);
    if (pause) await new Promise((r) => setTimeout(r, pause));
    waitMs = 0;
    const res = await fetch(url, { headers: UA }).catch(() => null);
    if (!res) continue;
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers?.get?.('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) {
        waitMs = Math.min(retryAfter * 1000, 5000);
      }
      continue;
    }
    if (!res.ok) return null; // صفحه وجود ندارد — تلاش مجدد فایده ندارد
    const data = await res.json().catch(() => null);
    const wikitext = data?.parse?.wikitext?.['*'];
    return wikitext ? { title: data.parse.title, wikitext } : null;
  }
  return { transient: true };
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
      .replace(/[\u0643]/g, 'ک') // کاف عربی → کاف فارسی (ویکی‌واژه گاهی «كتاب» می‌نویسد)
      .replace(/[\u064a]/g, 'ی') // یای عربی → یای فارسی
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
export async function lookupPersian(rawWord, { fast = false } = {}) {
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
    const entry = await lookupGerman(de, { fast }).catch(() => null);
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
/**
 * معنیِ دستیِ دقیق برای کلمات پرتکرارِ بدون ترجمه‌ی فارسی در ویکی‌واژه.
 * MyMemory برای همین کلمه‌ها آشغال می‌دهد (درسِ واقعی: bei → کمپین، schon → آره،
 * noch → «بله هنوز هم»، hier → «اینجاست») — پس قبل از MyMemory، این نقشه چک می‌شود.
 * ویکی‌واژه همچنان اولویت دارد (شاخه‌ی faTranslations در lookupGerman)؛ override
 * فقط جایگزینِ پشتیبانِ MyMemory است. کلیدها کوچک‌اند؛ lookup با کلمه‌ی کوچک‌شده انجام می‌شود.
 */
export const PERSIAN_OVERRIDES = {
  bei: 'نزد، پیش، در، کنار، با',
  mehr: 'بیشتر',
  eben: 'دقیقاً، همین‌طور',
  hier: 'اینجا',
  wessen: 'مال کی',
  wen: 'چه کسی را',
  wem: 'به چه کسی',
  wenig: 'کم، کمی، قدری',
  sie: 'او، آن‌ها، شما',
  ihr: 'شما، مال او',
  als: 'وقتی که، به‌عنوان، از',
  um: 'دور، حدود، در',
  über: 'روی، درباره، بیش از',
  nach: 'پس از، به، بعد از',
  auf: 'روی، بر، در',
  zu: 'به، تا، برای',
  von: 'از، از طرف',
  durch: 'از طریق، از میان',
  seit: 'از، از زمانی که',
  mögen: 'دوست داشتن، میل داشتن، خواستن',
  schon: 'قبلاً، دیگر',
  noch: 'هنوز، هنوز هم، دیگر',
  man: 'آدم، انسان، یک نفر',
  es: 'آن، این',
  da: 'آنجا، آنگاه',
  doch: 'اما، با این حال',
  nicht: 'نه، نیست',
  kein: 'هیچ، هیچ‌کدام',
  müssen: 'باید، مجبور بودن',
  sollen: 'باید، قرار است',
  gehen: 'رفتن',
  kommen: 'آمدن',
  werden: 'شدن',
  gut: 'خوب',
  bekannt: 'شناخته‌شده، مشهور',
  bekannte: 'آشنا',
};

/**
 * معنی فارسیِ یک مدخل اسمی — همان ترتیب مدخل اصلی: ترجمه‌ی خود ویکی‌واژه،
 * بعد override دستی، بعد MyMemory، و در آخر ویکی‌واژه‌ی انگلیسی.
 * (برای اسم‌شدنِ فعل‌ها در nounForm استفاده می‌شود.)
 */
async function persianForNounEntry(parsed) {
  if (parsed.faTranslations?.length) return parsed.faTranslations.slice(0, 6).join('، ');
  const lower = parsed.word.toLowerCase();
  if (PERSIAN_OVERRIDES[lower]) return PERSIAN_OVERRIDES[lower];
  return (await translateToPersian(parsed.word).catch(() => null))
    ?? (await fetchEnWiktionaryFa(parsed.word).catch(() => null));
}

export async function lookupGerman(rawWord, { fast = false } = {}) {
  return lookupGermanInternal(rawWord, { fast, allowFormRedirect: true });
}

async function lookupGermanInternal(rawWord, { fast = false, allowFormRedirect = true } = {}) {
  const input = String(rawWord || '').trim();
  const reflexiveMatch = input.match(/^sich\s+(\S+)/i);
  const reflexive = Boolean(reflexiveMatch);
  const word = reflexiveMatch ? reflexiveMatch[1] : input.split(/\s+/)[0];
  if (!word) return { found: false, word: '', reflexive: false, formOf: null, also: null };

  const cacheKey = `dict:v11:${word}`;
  const normalizeReturn = (entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const out = { ...entry, reflexive };
    if (!out.formOf || String(out.formOf.form || '') !== word) {
      out.formOf = null;
      out.also = null;
    } else if (!('also' in out)) {
      out.also = null;
    }
    return out;
  };
  const cached = await kv.getJSON(cacheKey).catch(() => null);
  if (cached) {
    // خودترمیمی: ورودیِ مسمومِ کش (صفحه‌ی صرفی به‌جای مدخل اصلی، یا مدخل خالی)
    // را دور بریز و از اول واکشی کن — هرگز دوباره سرو نشود.
    // (درس Buch: کش v9 یک «Konjugierte» را به‌جای اسم ذخیره کرده بود.)
    const poisoned = FORM_TYPE.test(cached.wordType || '')
      || (!cached.wordType && !(cached.definitions || []).length);
    if (!poisoned) return normalizeReturn(cached);
  }

  // بزرگی/کوچکی حرف اول در آلمانی معنی دارد: اول دقیقاً همان املای تایپ‌شده بررسی می‌شود.
  // اگر همان املا فرم صرفیِ قابل‌حل باشد، مدخل بزرگ‌نوشتِ بعدی نباید جایش را بگیرد.
  const capitalized = word.charAt(0).toUpperCase() + word.slice(1);
  const lowercase = word.charAt(0).toLowerCase() + word.slice(1);
  const candidates = [...new Set([word, capitalized, lowercase])];

  const fetchParsed = async (candidate) => {
    const page = await fetchWiktionary(candidate).catch(() => null);
    if (page?.transient) return { transient: true };
    if (!page?.wikitext) return null;
    const parsed = parseEntry(page.title, page.wikitext);
    return parsed.found ? parsed : null;
  };

  const resolveFormEntry = async (candidateFormEntry) => {
    if (!allowFormRedirect || !candidateFormEntry) return null;
    const base = candidateFormEntry.formBase || null;
    if (!base || base.toLowerCase() === word.toLowerCase()) return null;
    const baseEntry = await lookupGermanInternal(base, { fast, allowFormRedirect: false }).catch(() => null);
    if (!baseEntry?.found || FORM_TYPE.test(baseEntry.wordType || '')) return null;
    let also = null;
    if (capitalized !== word) {
      const capEntry = await lookupGermanInternal(capitalized, { fast, allowFormRedirect: false }).catch(() => null);
      if (capEntry?.found && !FORM_TYPE.test(capEntry.wordType || '')
        && capEntry.word.toLowerCase() !== (baseEntry.word || base).toLowerCase()) {
        also = {
          word: capEntry.word,
          type: capEntry.wordType || capEntry.type || null,
          article: capEntry.article || null,
          persian: capEntry.persian
            || (await persianForNounEntry(capEntry).catch(() => null))
            || null,
        };
      }
    }
    const redirected = {
      ...baseEntry,
      reflexive,
      formOf: {
        form: word,
        base: baseEntry.word || base,
        grammar: candidateFormEntry.formGrammar || null,
      },
      also,
    };
    await kv.setJSON(cacheKey, redirected, 30 * 24 * 3600).catch(() => {});
    return redirected;
  };

  let entry = { found: false, word };
  let formEntry = null;
  let asTypedFormResolveFailed = false;
  const asTyped = await fetchParsed(word);
  if (asTyped?.transient) return normalizeReturn({ found: false, word });
  if (asTyped) {
    if (!FORM_TYPE.test(asTyped.wordType || '')) {
      entry = asTyped;
    } else {
      formEntry = asTyped;
      // Deklinierte Formen (bekannte → bekannt) sind case-sensitiv: die großgeschriebene
      // Hauptform darf sie nicht verdrängen. Bei konjugierten Homographen (haus/Haus)
      // bleibt dagegen die Hauptform-Vorliebe der übrigen Kandidaten maßgeblich.
      if (/^Deklinierte/.test(asTyped.wordType || '')) {
        const redirected = await resolveFormEntry(formEntry);
        if (redirected) return redirected;
        asTypedFormResolveFailed = true;
      }
    }
  }
  if (!entry.found) {
    for (const c of candidates.slice(1)) {
      const parsed = await fetchParsed(c);
      if (parsed?.transient) continue;
      if (parsed) {
        if (!FORM_TYPE.test(parsed.wordType || '')) { entry = parsed; break; }
        formEntry = formEntry || parsed;
      }
    }
  }
  if (!entry.found && formEntry) {
    if (!(formEntry === asTyped && asTypedFormResolveFailed)) {
      const redirected = await resolveFormEntry(formEntry);
      if (redirected) return redirected;
    }
    entry = formEntry;
  }
  if (!entry.found) return normalizeReturn(entry);

  // معنی فارسی: اول ترجمه‌ی خودِ ویکی‌واژه (دقیق)؛ MyMemory فقط پشتیبان است
  // (درس machen: ‏MyMemory‏ «داشتن» و «beat» می‌داد، ولی ویکی‌واژه «کردن» و «make, do» دارد)
  if (entry.faTranslations?.length) {
    entry.faSource = 'wiktionary'; // ترجمه‌ی خودِ مدخل — بازبینی AI حق اصلاحش را ندارد
    const items = entry.faTranslations.slice(0, 6);
    // برای فعل‌ها مصدر اول بیاید. مصدر فارسی به «تن» یا «دن» تمام می‌شود:
    // داشتن قبل از دارند، رفتن قبل از پیاده‌روی، کردن قبل از کن
    // (باگ قبلی: فقط «دن» چک می‌شد و مصدرهای «تن»دار مثل داشتن/رفتن جا می‌ماندند)
    if (entry.wordType === 'Verb') {
      const isMasdar = (s) => /(تن|دن)$/.test(s);
      // مصدر اول؛ بین مصدرها کوتاه‌تر اول (مصدر پایه: دویدن قبل از لیز خوردن، کردن قبل از انجام دادن)
      items.sort((a, b) => (isMasdar(b) ? 1 : 0) - (isMasdar(a) ? 1 : 0) || a.length - b.length);
    }
    entry.persian = items.join('، ');
  } else if (PERSIAN_OVERRIDES[word.toLowerCase()]) {
    // معنیِ دستیِ دقیق — قبل از MyMemory (که برای همین کلمه‌ها آشغال می‌دهد).
    entry.persian = PERSIAN_OVERRIDES[word.toLowerCase()];
    entry.faSource = 'override'; // دستی و قطعی — بازبینی AI حق اصلاحش را ندارد
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
    entry.faSource = entry.persian ? 'fallback' : null; // منبع پشتیبان — بازبینی AI می‌تواند اصلاحش کند
  }
  // اسم‌شدنِ فعل: هر فعل آلمانی به‌عنوان اسم هم کاربرد دارد (das Essen، das Lernen).
  // صفحه‌ی مصدرِ بزرگ‌نوشت را می‌خوانیم؛ اگر اسم بود، با آرتیکل و معنی‌اش ذخیره می‌شود،
  // وگرنه مصدر اسمی همیشه خنثی است (das) و معنیِ خودِ فعل را می‌گیرد.
  // (قبل از tail و کش نوشته می‌شود تا با مدخل کش شود.)
  if (entry.wordType === 'Verb') {
    const nounWord = entry.word.charAt(0).toUpperCase() + entry.word.slice(1);
    let nounForm = null;
    const nounPage = await fetchWiktionary(nounWord).catch(() => null);
    if (nounPage?.wikitext) {
      const nounParsed = parseEntry(nounPage.title, nounPage.wikitext);
      if (nounParsed.found && nounParsed.wordType === 'Substantiv') {
        const nounPersian = await persianForNounEntry(nounParsed).catch(() => null);
        nounForm = {
          word: nounParsed.word,
          article: nounParsed.article || 'das',
          persian: nounPersian || entry.persian || null,
          definitions: (nounParsed.definitions || []).slice(0, 4),
          examples: (nounParsed.examples || []).slice(0, 2).map((de) => ({ de })),
        };
      }
    }
    entry.nounForm = nounForm || {
      word: nounWord,
      article: 'das',
      persian: entry.persian || null,
      definitions: [],
      examples: [],
    };
  }
  // تصویر واقعی از ویکی‌واژه + برگردان انگلیسی از خود مدخل (برای ساخت تصویر)
  // + غنی‌سازی DWDS — سه واکشی مستقل، موازی (درس کندی: قبلا پشت سر هم بودند)
  // fast=true: اسکریپ DWDS حداکثر ۲٫۵ ثانیه صبر می‌کند (اسکریپِ DWDS گاهی ۱۲ ثانیه
  // طول می‌کشد و پاسخ را قفل می‌کند)؛ بعد از تایم‌اوت dwds خالی می‌ماند و پاسخ ادامه می‌یابد.
  const dwdsPromise = fetchDwds(entry.word).catch(() => null);
  const [image, english] = await Promise.all([
    fetchWikiImage(entry.word).catch(() => null),
    entry.enTranslations?.length
      ? Promise.resolve(entry.enTranslations.slice(0, 3).join(', '))
      : translateToEnglish(entry.word).catch(() => null),
  ]);
  const dwds = fast
    ? await Promise.race([dwdsPromise, new Promise((r) => setTimeout(() => r(null), 2500))])
    : await dwdsPromise;
  entry.image = image;
  entry.english = english;
  entry.dwds = dwds;
  entry.reflexive = reflexive;
  entry.formOf = null;
  entry.also = null;
  await kv.setJSON(cacheKey, entry, 30 * 24 * 3600).catch(() => {});
  return normalizeReturn(entry);
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
  if (e.synonyms?.length) lines.push('', `🟰 مترادف: ${e.synonyms.join('، ')}`);
  if (e.antonyms?.length) lines.push(`➖ متضاد: ${e.antonyms.join('، ')}`);
  if (e.dwds?.collocations?.length) {
    lines.push('', `🔗 ترکیب‌های رایج: ${e.dwds.collocations.slice(0, 4).join(' • ')}`);
  }
  if (e.examples?.length) {
    lines.push('');
    // مثال‌های کوتاه و تمیز اول؛ نقل‌قول‌های ادبی بلند آخر صف
    const sorted = [...e.examples].sort((a, b) => (a.length > 150) - (b.length > 150));
    sorted.slice(0, 2).forEach((ex) => lines.push(`📝 مثال: ${ex}`));
  }
  if (e.dwds?.examples?.length) {
    const extra = e.dwds.examples.find((x) => !(e.examples || []).includes(x));
    if (extra) lines.push(`📚 مثال (DWDS): ${extra}`);
  }
  return lines.join('\n');
}
