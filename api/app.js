// API اپ موبایل (React Native / Expo) — از همان مغز ربات بله استفاده می‌کند:
// دیکشنری (ویکی‌واژه + DWDS)، بازبینی AI، ترجمه‌ی متن و جعبه‌ی لایتنر.
// کاربر اپ با uid (شناسه‌ی تصادفیِ روی دستگاه) شناخته می‌شود؛ کارت‌هایش جدا از بله
// با پیشوند app: ذخیره می‌شوند.
//
// GET  /api/app?action=lookup&q=Hund&dir=de        → مدخل آلمانی (JSON)
// GET  /api/app?action=lookup&q=سگ&dir=fa          → معادل‌های آلمانی
// POST /api/app?action=translate  { text }         → ترجمه‌ی متن (جهت خودکار)
// GET  /api/app?action=leitner.list&uid=...        → همه‌ی کارت‌ها
// GET  /api/app?action=leitner.due&uid=...         → کارت‌های سررسید
// POST /api/app?action=leitner.add    { uid, entry, baseDays }
// POST /api/app?action=leitner.review { uid, cardId, known }
// POST /api/app?action=leitner.remove { uid, cardId }
// تلفظ از endpoint موجود استفاده می‌کند: /api/tts?t=der+Hund&raw=1

import { lookupGerman, lookupPersian, pluralText } from '../lib/dictionary.js';
import { translateText, detectDirection } from '../lib/translate.js';
import { addCard, listCards, dueCards, answerCard, removeCard } from '../lib/leitner.js';
import {
  fetchCommonsPhotoUrl, fetchOpenversePhotoUrl, fetchPixabayPhotoUrl,
  downloadImageBuffer, generateImageBuffer,
} from '../lib/media.js';
import { applyReview } from '../lib/ai-check.js';
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

/** نسخه‌ی لاغر مدخل برای اپ + تصویر + بازبینی AI (همان رفتار ربات) */
async function buildPayload(entry, withReview = true) {
  let image = await resolveImage(entry).catch(() => null);
  let imageUrl = image?.url || null;
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
        await kv.setJSON(`dict:v7:${entry.word.toLowerCase()}`, entry).catch(() => {});
      }
    }
  }
  return {
    word: entry.word,
    type: wordTypeOf(entry),
    article: entry.article || null,
    plural: entry.plural || null,
    pluralFull: pluralText(entry),
    persian: entry.persian || null,
    english: entry.english || null,
    ipa: entry.ipa || null,
    definitions: entry.definitions || [],
    examples: entry.examples || [],
    synonyms: entry.synonyms || [],
    antonyms: entry.antonyms || [],
    dwdsExamples: entry.dwds?.examples || [],
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
      if (req.query?.dir === 'fa') {
        const result = await lookupPersian(q);
        if (!result.found) { send(res, 200, { ok: true, found: false, word: result.word, equivalents: [] }); return; }
        const equivalents = [];
        for (const eq of result.equivalents) {
          equivalents.push({
            de: eq.de,
            entry: eq.entry ? await buildPayload(eq.entry, eq === result.equivalents[0]) : null,
          });
        }
        send(res, 200, { ok: true, found: true, word: result.word, equivalents });
        return;
      }
      const entry = await lookupGerman(q);
      if (!entry.found) { send(res, 200, { ok: true, found: false, word: q }); return; }
      send(res, 200, { ok: true, found: true, entry: await buildPayload(entry) });
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
