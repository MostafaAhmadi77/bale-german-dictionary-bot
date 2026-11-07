// نقطه‌ی ورود ربات بله — وبهوک (Vercel Serverless Function)
// بله آپدیت‌ها را با POST به این آدرس می‌فرستد (هم‌شکل آپدیت‌های تلگرام).
// امکانات: دیکشنری آلمانی→فارسی و فارسی→آلمانی، تصویر هر کلمه، تلفظ صوتی، جعبه‌ی لایتنر، منوی دکمه‌ای.

import {
  sendMessage, answerCallbackQuery, inlineKeyboard, btn, replyKeyboard,
  sendPhotoBuffer, sendAudioBuffer,
} from '../lib/bale.js';
import {
  lookupGerman, formatEntry, lookupPersian, formatPersianResult,
} from '../lib/dictionary.js';
import { generateImageBuffer, downloadImageBuffer, fetchTTSMp3 } from '../lib/media.js';
import { kv } from '../lib/store.js';
import {
  addCard, getCard, listCards, dueCards, answerCard, removeCard, MAX_BOX,
} from '../lib/leitner.js';

const HELP = `🇩🇪 دیکشنری آلمانی ⇄ فارسی

کلمه بفرستید و بگیرید:
• آرتیکل (der / die / das) و حالت جمع
• توضیح به آلمانی + معنی فارسی
• 🖼 تصویر کلمه و دکمه‌ی 🔊 تلفظ (عادی و آهسته)

از منوی پایین استفاده کنید:
📦 جعبه لایتنر — کلمه‌های ذخیره‌شده به ترتیب
🔁 مرور کلمات — مرور رسیده‌ها
🌐 تغییر زبان — جابه‌جایی بین «آلمانی ← فارسی» و «فارسی ← آلمانی»

در حالت فارسی ← آلمانی، همه‌ی معادل‌های آلمانی کلمه به ترتیب رواج نوشته می‌شوند.`;

// ----- حالت زبان هر کاربر: 'de' = آلمانی→فارسی | 'fa' = فارسی→آلمانی -----
const modeKey = (userId) => `mode:${userId}`;
const getMode = async (userId) => (await kv.getJSON(modeKey(userId)).catch(() => null)) || 'de';
const setMode = (userId, m) => kv.setJSON(modeKey(userId), m);

const menuKeyboard = (mode) => replyKeyboard([
  ['📦 جعبه لایتنر', '🔁 مرور کلمات'],
  [mode === 'de' ? '🌐 ترجمه فارسی به آلمانی' : '🌐 ترجمه آلمانی به فارسی'],
]);

const lastKey = (userId) => `last:${userId}`;      // آخرین مدخل آلمانی (برای لایتنر/تلفظ)
const lastFaKey = (userId) => `lastfa:${userId}`;  // آخرین معادل‌های فارسی→آلمانی
const pendingKey = (userId) => `pending:${userId}`;

/** ارسال تصویر کلمه: اول عکس واقعی ویکی‌واژه، وگرنه تصویر ساخته‌شده با AI از روی مفهوم درست */
async function sendWordImage(chatId, entry, conceptOverride) {
  try {
    let buf = null;
    if (entry.image) buf = await downloadImageBuffer(entry.image);
    if (!buf) buf = await generateImageBuffer(entry.word, conceptOverride || entry.english);
    if (buf) {
      await sendPhotoBuffer(chatId, buf,
        `🖼 ${entry.article ? entry.article + ' ' : ''}${entry.word}${entry.persian ? ` — ${entry.persian}` : ''}`);
    }
  } catch (err) {
    console.error('image error:', err);
  }
}

async function startReview(chatId, userId) {
  const due = await dueCards(userId);
  if (!due.length) {
    const all = await listCards(userId);
    await sendMessage(chatId, all.length
      ? '🎉 امروز کلمه‌ای برای مرور نداری. همه سر وقت خودشون میان!'
      : '📦 جعبه‌ات خالی است. اول یک کلمه جست‌وجو کن و به لایتنر اضافه‌اش کن.');
    return;
  }
  const card = due[0];
  await sendMessage(
    chatId,
    `🔁 مرور (${due.length} کلمه باقی مانده)\n\nاین کلمه را به یاد می‌آوری؟\n\n🇩🇪 ${card.entry.article ? card.entry.article + ' ' : ''}${card.word}\nخانه‌ی ${card.box} از ${MAX_BOX}`,
    inlineKeyboard([[btn('👀 نمایش معنی', `rev:show:${card.id}`)]]),
  );
}

/** نمایش جعبه‌ی لایتنر به ترتیب اضافه شدن */
async function showBox(chatId, userId) {
  const cards = await listCards(userId, 'created');
  if (!cards.length) {
    await sendMessage(chatId, '📦 جعبه‌ی لایتنرت خالی است.\nیک کلمه جست‌وجو کن و دکمه‌ی «افزودن به لایتنر» را بزن.');
    return;
  }
  const lines = ['📦 جعبه‌ی لایتنر شما (به ترتیب اضافه شدن):', ''];
  cards.forEach((c, i) => {
    const due = c.nextReviewAt <= Date.now() ? '⏰ رسیده' : '';
    lines.push(`${i + 1}. ${c.entry.article ? c.entry.article + ' ' : ''}${c.word} — خانه‌ی ${c.box} ${due}`);
  });
  await sendMessage(chatId, lines.join('\n'),
    inlineKeyboard([[btn('🔁 شروع مرور', 'cron:review')]]));
}

async function toggleMode(chatId, userId) {
  const cur = await getMode(userId);
  const next = cur === 'de' ? 'fa' : 'de';
  await setMode(userId, next);
  await sendMessage(
    chatId,
    next === 'fa'
      ? '🌐 حالت عوض شد: حالا کلمه‌ی فارسی بفرستید، معادل‌های آلمانی‌اش را به ترتیب می‌گیرید.'
      : '🌐 حالت عوض شد: حالا کلمه‌ی آلمانی بفرستید، معنی فارسی + تصویر + تلفظ می‌گیرید.',
    menuKeyboard(next),
  );
}

async function handleGermanLookup(chatId, userId, text) {
  const entry = await lookupGerman(text);
  await sendMessage(
    chatId,
    formatEntry(entry),
    entry.found
      ? inlineKeyboard([
          [btn('📦 افزودن به لایتنر', 'leitner:add'), btn('🔊 تلفظ', 'tts')],
        ])
      : undefined,
  );
  if (entry.found) {
    await kv.setJSON(lastKey(userId), entry);
    await sendWordImage(chatId, entry); // تصویر بعد از متن
  }
}

async function handlePersianLookup(chatId, userId, text) {
  const result = await lookupPersian(text);
  if (!result.found) {
    await sendMessage(chatId, formatPersianResult(result));
    return;
  }
  // برای هر معادل یک دکمه‌ی افزودن به لایتنر
  const rows = result.equivalents.map((eq, i) => [
    btn(`📦 افزودن «${eq.de}» به لایتنر`, `faadd:${i}`),
  ]);
  await sendMessage(chatId, formatPersianResult(result), inlineKeyboard(rows));
  await kv.setJSON(lastFaKey(userId), result.equivalents.map((eq) => eq.entry || { word: eq.de }));
  // تصویر: اول معادلی که عکس واقعی دارد؛ وگرنه ساخت تصویر از مفهوم انگلیسیِ خود کلمه‌ی فارسی
  const withImage = result.equivalents.find((eq) => eq.entry?.image)?.entry;
  const first = withImage || result.equivalents[0]?.entry;
  if (first) await sendWordImage(chatId, first, result.englishConcept);
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id ?? chatId;
  const text = (msg.text || '').trim();
  if (!chatId || !text) return;

  if (text === '/start') {
    const mode = await getMode(userId);
    await sendMessage(chatId, `سلام! 👋\n\n${HELP}`, menuKeyboard(mode));
    return;
  }
  if (text === '/help') { await sendMessage(chatId, HELP); return; }
  if (text === '/menu') {
    await sendMessage(chatId, 'منوی اصلی:', menuKeyboard(await getMode(userId)));
    return;
  }

  // دکمه‌های منوی پایین
  if (text === '📦 جعبه لایتنر' || text === '/mywords') { await showBox(chatId, userId); return; }
  if (text === '🔁 مرور کلمات' || text === '/review') { await startReview(chatId, userId); return; }
  if (text.startsWith('🌐')) { await toggleMode(chatId, userId); return; }

  if (text === '/lang') { await toggleMode(chatId, userId); return; }
  if (text === '/due') {
    const due = await dueCards(userId);
    await sendMessage(chatId, due.length
      ? `⏰ امروز ${due.length} کلمه برای مرور داری. با دکمه‌ی «مرور کلمات» شروع کن.`
      : '🎉 امروز چیزی برای مرور نداری.');
    return;
  }
  if (text.startsWith('/')) {
    await sendMessage(chatId, 'دستور ناشناخته است. /help را ببین.');
    return;
  }

  const mode = await getMode(userId);
  if (mode === 'fa') await handlePersianLookup(chatId, userId, text);
  else await handleGermanLookup(chatId, userId, text);
}

async function askInterval(chatId, userId, entry) {
  await kv.setJSON(pendingKey(userId), { entry }, 10 * 60);
  await sendMessage(
    chatId,
    `📦 «${entry.word}» هر چند روز یک‌بار مرور شود؟`,
    inlineKeyboard([[
      btn('هر روز', 'leitner:int:1'),
      btn('هر ۳ روز', 'leitner:int:3'),
      btn('هر هفته', 'leitner:int:7'),
    ]]),
  );
}

async function sendPronunciation(chatId, userId) {
  const entry = await kv.getJSON(lastKey(userId));
  if (!entry) { await sendMessage(chatId, 'اول یک کلمه‌ی آلمانی جست‌وجو کن.'); return; }
  const label = `${entry.article ? entry.article + ' ' : ''}${entry.word}`;
  const speakText = entry.article ? `${entry.article} ${entry.word}` : entry.word;
  const [normal, slow] = await Promise.all([
    fetchTTSMp3(speakText, false),
    fetchTTSMp3(speakText, true),
  ]);
  if (!normal && !slow) {
    await sendMessage(chatId, '⚠️ تلفظ الان در دسترس نیست. دوباره تلاش کن.');
    return;
  }
  if (normal) await sendAudioBuffer(chatId, normal, `🔊 تلفظ عادی — ${label}`, label);
  if (slow) await sendAudioBuffer(chatId, slow, `🐢 تلفظ آهسته — ${label}`, `${label} (آهسته)`);
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const userId = cb.from?.id ?? chatId;
  const data = cb.data || '';
  await answerCallbackQuery(cb.id);
  if (!chatId) return;

  if (data === 'cron:review') { await startReview(chatId, userId); return; }
  if (data === 'tts') { await sendPronunciation(chatId, userId); return; }

  if (data === 'leitner:add') {
    const entry = await kv.getJSON(lastKey(userId));
    if (!entry) { await sendMessage(chatId, 'اول یک کلمه جست‌وجو کن.'); return; }
    await askInterval(chatId, userId, entry);
    return;
  }

  if (data.startsWith('faadd:')) {
    const idx = Number(data.split(':')[1]);
    const list = await kv.getJSON(lastFaKey(userId));
    const entry = list?.[idx];
    if (!entry) { await sendMessage(chatId, 'مهلت این افزودن تمام شده؛ کلمه را دوباره جست‌وجو کن.'); return; }
    await askInterval(chatId, userId, entry);
    return;
  }

  if (data.startsWith('leitner:int:')) {
    const baseDays = Number(data.split(':')[2]) || 1;
    const pending = await kv.getJSON(pendingKey(userId));
    if (!pending?.entry) { await sendMessage(chatId, 'مهلت این افزودن تمام شده؛ کلمه را دوباره جست‌وجو کن.'); return; }
    const card = await addCard(userId, pending.entry, baseDays);
    await kv.del(pendingKey(userId));
    await sendMessage(chatId, `✅ «${card.word}» به جعبه‌ی لایتنر اضافه شد.\nاولین مرور: ${baseDays} روز دیگر. بعد از هر «بلدم ✅» فاصله دو برابر می‌شود.`);
    return;
  }

  if (data.startsWith('rev:show:')) {
    const card = await getCard(userId, data.split(':')[2]);
    if (!card) { await sendMessage(chatId, 'این کارت دیگر نیست.'); return; }
    await sendMessage(
      chatId,
      formatEntry(card.entry),
      inlineKeyboard([[
        btn('✅ بلدم', `rev:know:${card.id}`),
        btn('❌ بلد نیستم', `rev:dunno:${card.id}`),
        btn('🗑 حذف', `rev:del:${card.id}`),
      ]]),
    );
    return;
  }

  if (data.startsWith('rev:know:') || data.startsWith('rev:dunno:')) {
    const known = data.startsWith('rev:know:');
    const card = await answerCard(userId, data.split(':')[2], known);
    if (card) {
      await sendMessage(chatId, known
        ? `✅ آفرین! «${card.word}» رفت به خانه‌ی ${card.box}.`
        : `🔁 «${card.word}» برگشت به خانه‌ی ۱ تا دوباره مرور شود.`);
    }
    await startReview(chatId, userId);
    return;
  }

  if (data.startsWith('rev:del:')) {
    await removeCard(userId, data.split(':')[2]);
    await sendMessage(chatId, '🗑 کارت حذف شد.');
    await startReview(chatId, userId);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  if (process.env.WEBHOOK_SECRET && req.query?.s !== process.env.WEBHOOK_SECRET) {
    res.status(401).json({ ok: false }); return;
  }
  try {
    const update = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (update?.message) await handleMessage(update.message);
    else if (update?.callback_query) await handleCallback(update.callback_query);
  } catch (err) {
    console.error('webhook error:', err);
  }
  res.status(200).json({ ok: true });
}
