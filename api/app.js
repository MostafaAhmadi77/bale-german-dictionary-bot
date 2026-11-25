// API اپ موبایل (React Native / Expo) — از همان مغز ربات بله استفاده می‌کند:
// دیکشنری (ویکی‌واژه + DWDS)، بازبینی AI، ترجمه‌ی متن و جعبه‌ی لایتنر.
// کاربر اپ با uid (شناسه‌ی تصادفیِ روی دستگاه) شناخته می‌شود؛ کارت‌هایش جدا از بله
// با پیشوند app: ذخیره می‌شوند.
//
// GET  /api/app?action=lookup&q=Hund&dir=de        → مدخل آلمانی (JSON)
// GET  /api/app?action=lookup&q=Hund&dir=de&fast=1  → همان، بدون بازبینی AI و بدون واکشی عکس
// GET  /api/app?action=lookup&q=سگ&dir=fa          → معادل‌های آلمانی
// GET  /api/app?action=examples&word=Hund&level=B1&count=3 → مثال‌های سطح‌بندی‌شده با ترجمه‌ی فارسی
// GET  /api/app?action=conjugation&word=gehen      → صرف کامل فعل (از Flexion:gehen در ویکی‌واژه)
// POST /api/app?action=translate  { text }         → ترجمه‌ی متن (جهت خودکار)
// GET  /api/app?action=leitner.list&uid=...        → همه‌ی کارت‌ها
// GET  /api/app?action=leitner.due&uid=...         → کارت‌های سررسید
// POST /api/app?action=leitner.add    { uid, entry, baseDays }
// POST /api/app?action=leitner.review { uid, cardId, known }
// POST /api/app?action=leitner.remove { uid, cardId }
// تلفظ از endpoint موجود استفاده می‌کند: /api/tts?t=der+Hund&raw=1

import { lookupGerman, lookupPersian, pluralText } from '../lib/dictionary.js';
import { getConjugation } from '../lib/conjugation.js';
import { translateText, detectDirection } from '../lib/translate.js';
import { addCard, listCards, dueCards, answerCard, removeCard } from '../lib/leitner.js';
import {
  fetchCommonsPhotoUrl, fetchOpenversePhotoUrl, fetchPixabayPhotoUrl,
  downloadImageBuffer, generateImageBuffer,
} from '../lib/media.js';
import { applyReview } from '../lib/ai-check.js';
import { generateLevelExamples } from '../lib/level-examples.js';
import { getTatoebaExamples } from '../lib/tatoeba.js';
import { kv } from '../lib/store.js';

function send(res, code, obj) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(code).json(obj);
}

const validUid = (uid) => /^[A-Za-z0-9-]{8,64}$/.test(String(uid || ''));
const appUser = (uid) => `app:${uid}`;
const wordTypeOf = (e) => e?.wordType || e?.type || null;

/** URL تصویر ساخته‌شده (Pollinations) — دقیقاً با همان فرمول lib/media.js، فقط برای اسم‌ها */
function generatedUrlFor(entry) {
  const token = (entry.english || '').split(',')[0].trim().replace(/^to\s+/i, '') || entry.word;
  const prompt = encodeURIComponent(
    `a clear realistic photograph of ${token}, single subject centered, plain neutral background, studio light, photorealistic, sharp focus, no text, no letters, no words, no watermark`);
  let seed = 0;
  for (const ch of entry.word) seed = (seed * 31 + ch.codePointAt(0)) % 100000;
  return `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=768&nologo=true&seed=${seed}`;
}

/** پیدا کردن بهترین URL تصویر برای مدخل، به همان ترتیب ربات */
async function resolveImage(entry) {
  if (entry.image) return { url: entry.image, kind: 'entry' };
  const gloss = entry.english;
  if (gloss) {
    const commons = await fetchCommonsPhotoUrl(gloss).catch(() => null);
    if (commons) return { url: commons, kind: 'commons' };
    const openverse = await fetchOpenversePhotoUrl(gloss).catch(() => null);
    if (openverse) return { url: openverse, kind: 'openverse' };
    const pixabay = await fetchPixabayPhotoUrl(gloss).catch(() => null);
    if (pixabay) return { url: pixabay, kind: 'pixabay' };
  }
  // ساخت تصویر فقط برای اسم‌ها (برای فعل/صفت بدون صحنه‌ی آماده، عکس اشتباه بدتر از نبودنش است)
  if (!wordTypeOf(entry) || wordTypeOf(entry) === 'Substantiv') {
    return { url: generatedUrlFor(entry), kind: 'generated' };
  }
  return null;
}

/** نسخه‌ی لاغر مدخل برای اپ + تصویر + بازبینی AI (همان رفتار ربات)
 * fast=true: بدون بازبینی AI و بدون واکشی عکس از کامنز/Openverse/Pixabay —
 * تصویر = عکس خود مدخل، وگرنه URL ساخته‌شده برای اسم‌ها، وگرنه null. بقیه‌ی فیلدها یکی‌اند. */
async function buildPayload(entry, withReview = true, fast = false) {
  let imageUrl = null;
  if (fast) {
    imageUrl = entry.image
      ? entry.image
      : (!wordTypeOf(entry) || wordTypeOf(entry) === 'Substantiv') ? generatedUrlFor(entry) : null;
  } else {
    let image = await resolveImage(entry).catch(() => null);
    imageUrl = image?.url || null;
    if (withReview && image && !entry.aiReviewed) {
      const buf = image.kind === 'generated'
        ? await generateImageBuffer(entry.word, entry.english, wordTypeOf(entry)).catch(() => null)
        : await downloadImageBuffer(image.url).catch(() => null);
      if (buf) {
        const img = { buf, kind: image.kind, url: image.url };
        const out = await applyReview(entry, img,
          () => generateImageBuffer(entry.word, entry.english, wordTypeOf(entry))).catch(() => img);
        if (out === null) imageUrl = null;
        else if (out !== img) imageUrl = (!wordTypeOf(entry) || wordTypeOf(entry) === 'Substantiv') ? generatedUrlFor(entry) : null;
        if (entry.aiReviewed) {
          await kv.setJSON(`dict:v11:${entry.word}`, entry).catch(() => {});
        }
      }
    }
  }
  return {
    word: entry.word,
    type: wordTypeOf(entry),
    article: entry.article || null,
    plural: entry.plural || null,
    pluralFull: pluralText(entry),
    nounForm: entry.nounForm
      ? {
          word: entry.nounForm.word,
          article: entry.nounForm.article || null,
          persian: entry.nounForm.persian || null,
          definitions: Array.isArray(entry.nounForm.definitions)
            ? entry.nounForm.definitions.slice(0, 4)
            : [],
          examples: Array.isArray(entry.nounForm.examples)
            ? entry.nounForm.examples.slice(0, 2)
              .map((ex) => ({ de: typeof ex === 'string' ? ex : (ex?.de || '') }))
              .filter((ex) => ex.de)
            : [],
        }
      : null,
    formOf: entry.formOf
      ? {
          form: entry.formOf.form || null,
          base: entry.formOf.base || null,
          grammar: entry.formOf.grammar || null,
        }
      : null,
    reflexive: Boolean(entry.reflexive),
    also: entry.also
      ? {
          word: entry.also.word || null,
          type: entry.also.type || entry.also.wordType || null,
          article: entry.also.article || null,
          persian: entry.also.persian || null,
        }
      : null,
    persian: entry.persian || null,
    english: entry.english || null,
    ipa: entry.ipa || null,
    definitions: entry.definitions || [],
    examples: entry.examples || [],
    synonyms: entry.synonyms || [],
    antonyms: entry.antonyms || [],
    dwdsExamples: entry.dwds?.examples || [],
    tatoebaExamples: getTatoebaExamples(entry.word),
    collocations: entry.dwds?.collocations || [],
    imageUrl,
    speak: `${entry.article ? entry.article + ' ' : ''}${entry.word}`,
  };
}

const slimCard = (c) => ({
  id: c.id,
  word: c.word,
  box: c.box,
  baseDays: c.baseDays,
  createdAt: c.createdAt,
  nextReviewAt: c.nextReviewAt,
  entry: {
    word: c.entry.word,
    type: wordTypeOf(c.entry),
    article: c.entry.article || null,
    plural: c.entry.plural || null,
    persian: c.entry.persian || null,
    english: c.entry.english || null,
    imageUrl: c.entry.image || null,
    speak: `${c.entry.article ? c.entry.article + ' ' : ''}${c.entry.word}`,
    example: (c.entry.examples && c.entry.examples[0]) || null,
  },
});

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return; }
  const action = String(req.query?.action || '');
  const body = await readBody(req);
  const uid = req.query?.uid || body.uid;
  try {
    if (action === 'lookup') {
      const q = String(req.query?.q || '').trim();
      if (!q) { send(res, 400, { ok: false, error: 'q required' }); return; }
      // fast=1: جست‌وجوی فوری — بدون بازبینی AI و بدون واکشی عکس (معنی فورا می‌رسد؛
      // تصویرِ کامل در صورت نیاز با فراخوان عادیِ بعدی می‌آید)
      const fast = req.query?.fast === '1';
      if (req.query?.dir === 'fa') {
        const result = await lookupPersian(q, { fast });
        if (!result.found) { send(res, 200, { ok: true, found: false, word: result.word, equivalents: [] }); return; }
        const equivalents = [];
        for (const eq of result.equivalents) {
          equivalents.push({
            de: eq.de,
            entry: eq.entry ? await buildPayload(eq.entry, eq === result.equivalents[0], fast) : null,
          });
        }
        send(res, 200, { ok: true, found: true, word: result.word, equivalents });
        return;
      }
      const entry = await lookupGerman(q, { fast });
      if (!entry.found) { send(res, 200, { ok: true, found: false, word: q }); return; }
      send(res, 200, { ok: true, found: true, entry: await buildPayload(entry, true, fast) });
      return;
    }

    if (action === 'examples') {
      const word = String(req.query?.word || '').trim();
      if (!word) { send(res, 400, { ok: false, error: 'word required' }); return; }
      const level = String(req.query?.level || 'B1');
      const count = Number(req.query?.count || 3);
      // حسِ کلمه برای مدل: معنی فارسی/انگلیسیِ مدخل (اگر کش شده باشد سریع است؛
      // نبودنش چیزی را خراب نمی‌کند — مدل فقط با خودِ کلمه کار می‌کند)
      let gloss = '';
      try {
        const entry = await lookupGerman(word);
        if (entry?.found) gloss = [entry.persian, entry.english].filter(Boolean).join(' / ');
      } catch { /* gloss خالی می‌ماند */ }
      send(res, 200, await generateLevelExamples(word, gloss, level, count));
      return;
    }

    if (action === 'conjugation') {
      const word = String(req.query?.word || '').trim();
      if (!word) { send(res, 400, { ok: false, error: 'word required' }); return; }
      const conjugation = await getConjugation(word);
      send(res, 200, conjugation.ok ? { ok: true, conjugation } : { ok: false, conjugation: null });
      return;
    }

    if (action === 'translate') {
      const text = String(body.text || req.query?.text || '').trim();
      if (!text) { send(res, 400, { ok: false, error: 'text required' }); return; }
      const [from, to] = body.from && body.to ? [body.from, body.to] : detectDirection(text);
      const r = await translateText(text, from, to);
      send(res, 200, { ok: true, failed: !!r.failed, text: r.text || '', from, to });
      return;
    }

    if (action.startsWith('leitner.')) {
      if (!validUid(uid)) { send(res, 400, { ok: false, error: 'uid invalid' }); return; }
      const userId = appUser(uid);
      if (action === 'leitner.list') {
        const cards = await listCards(userId, 'created');
        send(res, 200, { ok: true, cards: cards.map(slimCard) });
        return;
      }
      if (action === 'leitner.due') {
        const cards = await dueCards(userId);
        send(res, 200, { ok: true, cards: cards.map(slimCard) });
        return;
      }
      if (action === 'leitner.add') {
        const entry = body.entry;
        if (!entry?.word) { send(res, 400, { ok: false, error: 'entry.word required' }); return; }
        const baseDays = [1, 3, 7].includes(body.baseDays) ? body.baseDays : 1;
        const card = await addCard(userId, entry, baseDays);
        send(res, 200, { ok: true, card: slimCard(card) });
        return;
      }
      if (action === 'leitner.review') {
        const card = await answerCard(userId, String(body.cardId || ''), !!body.known);
        send(res, 200, { ok: true, card: card ? slimCard(card) : null });
        return;
      }
      if (action === 'leitner.remove') {
        await removeCard(userId, String(body.cardId || ''));
        send(res, 200, { ok: true });
        return;
      }
    }

    if (action === 'health') { send(res, 200, { ok: true, app: true }); return; }
    send(res, 404, { ok: false, error: 'unknown action' });
  } catch (e) {
    console.error('app api error:', e);
    send(res, 500, { ok: false, error: 'server' });
  }
}
