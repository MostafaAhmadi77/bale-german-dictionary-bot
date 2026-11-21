// صرف فعل آلمانی — داده از صفحه‌ی Flexion:<verb> در ویکی‌واژه‌ی آلمانی.
// چرا HTML و نه wikitext؟ wikitextِ صفحه‌ی صرف فقط یک فراخوانی قالب است
// (مثل {{Deutsch Verb unregelmäßig|...}}) و فرم‌ها فقط در HTMLِ رندرشده هستند.
// جدول‌ها کلاس de-verb-unregelmaessig یا de-verb-regelmaessig دارند؛ ساختارشان
// یکی است: سربرگ زمان (Präsens/Präteritum/…)، ردیف صداها (Aktiv/Passiv)، ردیف
// وجه‌ها (Indikativ/Konjunktiv I/II) و ردیف‌های ۶ شخص. فقط Aktiv خوانده می‌شود.
// نتیجه ۳۰ روز کش می‌شود (conj:v1:<verb>). خطا همیشه fail-open است: { ok: false }.

import { kv } from './store.js';

const UA = { 'user-agent': 'BaleGermanDictionaryBot/1.0 (educational dictionary bot)' };
const CACHE_TTL = 30 * 24 * 3600; // 30 روز

const TENSES = {
  'Präsens': 'praesens',
  'Präteritum': 'praeteritum',
  'Perfekt': 'perfekt',
  'Plusquamperfekt': 'plusquamperfekt',
  'Futur I': 'futur1',
  'Futur II': 'futur2',
};

// (زمان، وجه) → کجای خروجی می‌نشیند. ستون‌های Konjunktiv که در مشخصات نیست
// (مثلاً Konjunktiv I در Perfekt) خوانده نمی‌شوند. ستون Konjunktiv II در
// Futur همان فرم‌های würde است: Futur I ‏→ «Präteritum (würde)» و
// Futur II ‏→ «Plusquamperfekt (würde)» در اپ مرجع.
const TARGET = {
  'praesens|Indikativ': ['indikativ', 'praesens'],
  'praesens|Konjunktiv I': ['konjunktiv', 'konjunktiv1'],
  'praeteritum|Indikativ': ['indikativ', 'praeteritum'],
  'praeteritum|Konjunktiv II': ['konjunktiv', 'konjunktiv2'],
  'perfekt|Indikativ': ['indikativ', 'perfekt'],
  'plusquamperfekt|Indikativ': ['indikativ', 'plusquamperfekt'],
  'futur1|Indikativ': ['indikativ', 'futur1'],
  'futur1|Konjunktiv II': ['konjunktiv', 'praeteritumWuerde'],
  'futur2|Indikativ': ['indikativ', 'futur2'],
  'futur2|Konjunktiv II': ['konjunktiv', 'plusquamperfektWuerde'],
};

const PERSON_RE = /^(\d+)\.\s*Person\s+(Singular|Plural)/;
const PRONOUN_RE = /^(ich|du|er\/sie\/es|es|wir|ihr|sie)\s+/;
const VOICE_NAMES = new Set(['Aktiv', 'Vorgangspassiv', 'Zustandspassiv']);
const MOOD_NAMES = new Set(['Indikativ', 'Konjunktiv I', 'Konjunktiv II']);

/** decode موجودیت‌های HTML که در جدول‌ها دیده می‌شوند */
function decodeEntities(s) {
  return (s || '')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&#32;/g, ' ')
    .replace(/&#95;/g, '_')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** متن خالص یک سلول: تگ‌ها (و sup پانویس) حذف، موجودیت‌ها decode، فاصله‌ها یکی */
function cleanText(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<sup[^>]*>[\s\S]*?<\/sup>/g, '')
      // تگ‌ها با رشته‌ی خالی جایگزین می‌شوند تا «geh</a>!» به «geh !» تبدیل نشود؛
      // فاصله‌ها از خودِ متن (مثل «ich <a>gehe</a>») می‌آیند
      .replace(/<[^>]+>/g, ''),
  ).replace(/\s+/g, ' ').trim();
}

/** بخش‌های یک سلول جدا با <br> (صورت‌های جایگزین) — هر بخش تمیز شده */
function cellParts(cellHtml) {
  return String(cellHtml || '')
    .split(/<br\s*\/?>/i)
    .map(cleanText)
    .filter(Boolean);
}

/** اولین صورتِ یک سلول: بدون ضمیر (ich/du/er…)، بدون «—»، بدون ویرگولِ دنباله */
function firstForm(cellHtml) {
  const part = cellParts(cellHtml)[0];
  if (!part || part === '—') return null;
  const f = part
    .replace(PRONOUN_RE, '')
    // صورت‌های جایگزین/یادداشت («veraltet: …») بعد از ویرگول می‌آیند — فقط اولی
    .split(',')[0]
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/, '')
    .trim();
  return f && f !== '—' ? f : null;
}

// برچسب‌های صورت‌های کهنه/نادر در جدول امری («veraltet: machet!») — صورت اصلی نیستند
const USAGE_LABEL_RE = /^(veraltet|ungebräuchlich|umgangssprachlich|selten|vulgär|landschaftlich)\s*:/i;

/** جدول‌های inflection-table را با کلاس و ردیف‌هایشان بیرون می‌کشد */
function parseTables(html) {
  const tables = [];
  const tableRe = /<table[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/table>/g;
  let tm;
  while ((tm = tableRe.exec(html)) !== null) {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let rm;
    while ((rm = rowRe.exec(tm[2])) !== null) {
      const cells = [];
      const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/g;
      let cm;
      while ((cm = cellRe.exec(rm[1])) !== null) {
        cells.push({ tag: cm[1], html: cm[3], text: cleanText(cm[3]) });
      }
      if (cells.length) rows.push(cells);
    }
    tables.push({ cls: tm[1], rows });
  }
  return tables;
}

function parseConjugationHtml(html) {
  const tables = parseTables(html);
  if (!tables.length) return null;
  const irregular = tables.some((t) => /unregelmaessig/.test(t.cls));

  const grid = {}; // TARGET key -> [6 forms]
  const imperativ = [];
  const infinitive = {};

  const put = (section, key, personIdx, form) => {
    if (form == null) return;
    const k = `${section}:${key}`;
    (grid[k] = grid[k] || [])[personIdx] = form;
  };

  for (const table of tables) {
    let block = null; // نام بلوک فعلی: کلید TENSES یا 'imperativ' | 'infinitives' | 'partizipien'
    let voices = null; // ['Aktiv', 'Vorgangspassiv', 'Zustandspassiv']
    let moods = null; // وجه‌ها به‌ترتیب ستون‌ها
    let impCol = -1; // ستون «Präsens Aktiv» در جدول امری (از ردیف سربرگ خوانده می‌شود)
    let partizipDone = false;

    for (const row of table.rows) {
      const texts = row.map((c) => c.text);

      // ردیف سربرگ: یک سلول تنها (th یا td با colspan)
      if (row.length === 1) {
        const h = texts[0];
        if (TENSES[h]) block = TENSES[h];
        else if (h === 'Imperative') block = 'imperativ';
        else if (h === '(nichterweiterte) Infinitive') block = 'infinitives';
        else if (h === 'erweiterte Infinitive') block = 'infinitives-ext';
        else if (h === 'Partizipien') block = 'partizipien';
        else block = null;
        voices = null;
        moods = null;
        impCol = -1;
        partizipDone = false;
        continue;
      }
      if (!texts.some((x) => x)) continue; // ردیف خالی/فاصله‌گذار

      if (block === 'imperativ') {
        // سربرگ ستون‌ها: ['', 'Präsens Aktiv', 'Präsens Vorgangspassiv', …]
        if (texts[0] === '' && texts.includes('Präsens Aktiv')) {
          impCol = texts.indexOf('Präsens Aktiv');
          continue;
        }
        if (impCol > 0 && /Person|Höflichkeitsform/.test(texts[0])) {
          for (const part of cellParts(row[impCol].html)) {
            const f = part.replace(/,\s*$/, '').trim();
            if (f && f !== '—' && !USAGE_LABEL_RE.test(f)) imperativ.push(f);
          }
        }
        continue;
      }

      if (block === 'infinitives') {
        if (texts[0] === 'Aktiv') {
          const f1 = firstForm(row[1]?.html);
          const f2 = firstForm(row[2]?.html);
          if (f1) infinitive.infinitiv1 = f1;
          if (f2) infinitive.infinitiv2 = f2;
        }
        continue;
      }

      if (block === 'partizipien') {
        // قالب نامنظم یک ردیف سربرگ دارد (['Präsens Aktiv', 'Perfekt Passiv', …])؛
        // قالب منظم مستقیم ردیف داده را می‌آورد. در هر دو، اولین ردیف داده گرفته می‌شود.
        if (texts[0] === 'Präsens Aktiv') continue;
        if (!partizipDone) {
          const p1 = firstForm(row[0]?.html);
          const p2 = firstForm(row[1]?.html);
          if (p1) infinitive.partizip1 = p1;
          if (p2) infinitive.partizip2 = p2;
          partizipDone = true;
        }
        continue;
      }

      if (!block || !Object.values(TENSES).includes(block)) continue;
      const tense = block;

      // ردیف صداها و ردیف وجه‌ها در دو قالب جای‌شان عوض می‌شود (یکی «Person» اول،
      // دیگری خالی) — پس بر اساس محتوای سلول‌ها شناخته می‌شوند، نه سلول اول.
      const rest = texts.slice(1);
      if (rest.length >= 1 && rest.every((t) => VOICE_NAMES.has(t))) {
        voices = rest;
        continue;
      }
      if (rest.length >= 1 && rest.every((t) => MOOD_NAMES.has(t))) {
        moods = rest;
        continue;
      }
      const pm = texts[0].match(PERSON_RE);
      if (pm && voices && moods) {
        const personIdx = (Number(pm[1]) - 1) + (pm[2] === 'Plural' ? 3 : 0);
        const perVoice = moods.length / voices.length;
        if (!Number.isInteger(perVoice) || perVoice < 1) continue;
        // فقط Aktiv (گروه اول صداها) — ستون‌های Passiv نادیده گرفته می‌شوند
        for (let j = 0; j < perVoice; j++) {
          const mood = moods[j];
          const target = TARGET[`${tense}|${mood}`];
          if (!target) continue;
          put(target[0], target[1], personIdx, firstForm(row[1 + j]?.html));
        }
      }
    }
  }

  // فقط آرایه‌های کامل ۶تایی نگه داشته می‌شوند
  const take = (section, key) => {
    const arr = grid[`${section}:${key}`];
    return arr && arr.length === 6 && arr.every(Boolean) ? [...arr] : undefined;
  };

  const indikativ = {};
  for (const k of ['praesens', 'praeteritum', 'perfekt', 'plusquamperfekt', 'futur1', 'futur2']) {
    const v = take('indikativ', k);
    if (v) indikativ[k] = v;
  }
  const konjunktiv = {};
  for (const k of ['konjunktiv1', 'konjunktiv2', 'praeteritumWuerde', 'plusquamperfektWuerde']) {
    const v = take('konjunktiv', k);
    if (v) konjunktiv[k] = v;
  }

  // Hilfsverb از صورت Perfekt: bin/bist/… → sein، habe/hast/… → haben
  let aux = null;
  const perf0 = indikativ.perfekt?.[0] || '';
  if (/^(bin|bist|ist|sind|seid)\b/.test(perf0)) aux = 'sein';
  else if (/^(habe|hast|hat|haben|habt)\b/.test(perf0)) aux = 'haben';

  return {
    irregular,
    aux,
    sections: {
      indikativ,
      konjunktiv,
      imperativ,
      infinitive,
    },
  };
}

async function fetchFlexionHtml(verb) {
  const url = 'https://de.wiktionary.org/w/api.php?action=parse&prop=text&format=json&page='
    + encodeURIComponent(`Flexion:${verb}`);
  // تلاش مجدد با مکث افزاینده — مثل fetchWiktionary در dictionary.js
  for (const delay of [0, 700, 1800]) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const res = await fetch(url, { headers: UA }).catch(() => null);
    if (!res) continue;
    if (res.status === 429 || res.status >= 500) continue;
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const text = data?.parse?.text?.['*'];
    return text || null;
  }
  return null;
}

/**
 * صرف کامل یک فعل آلمانی.
 * برمی‌گرداند { ok, verb, aux, irregular, sections } که sections شکلش این است:
 * {
 *   indikativ: { praesens, praeteritum, perfekt, plusquamperfekt, futur1, futur2 },
 *   konjunktiv: { konjunktiv1, konjunktiv2, praeteritumWuerde?, plusquamperfektWuerde? },
 *   imperativ: [ 'geh!', 'gehe!', 'geht!', 'gehen Sie!' ],
 *   infinitive: { infinitiv1, infinitiv2, partizip1, partizip2 },
 * }
 * هر زمانِ خبری/التزامی آرایه‌ای از ۶ صورت است (ich/du/er/wir/ihr/sie، بدون ضمیر).
 * روی هر خطا { ok: false } برمی‌گردد و هیچ‌وقت throw نمی‌کند.
 */
export async function getConjugation(rawVerb) {
  try {
    const verb = String(rawVerb || '').trim().split(/\s+/)[0].toLowerCase();
    if (!verb || !/^[a-zäöüß]+$/.test(verb)) return { ok: false };
    const cacheKey = `conj:v1:${verb}`;
    const cached = await kv.getJSON(cacheKey).catch(() => null);
    if (cached && cached.ok) return cached;
    const html = await fetchFlexionHtml(verb);
    if (!html) return { ok: false };
    const parsed = parseConjugationHtml(html);
    if (!parsed || !parsed.sections?.indikativ?.praesens) return { ok: false };
    const result = {
      ok: true,
      verb,
      aux: parsed.aux,
      irregular: parsed.irregular,
      sections: parsed.sections,
    };
    await kv.setJSON(cacheKey, result, CACHE_TTL).catch(() => {});
    return result;
  } catch {
    return { ok: false };
  }
}
