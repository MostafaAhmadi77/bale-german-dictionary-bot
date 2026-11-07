// نقطه‌ی ورود ربات بله — وبهوک (Vercel Serverless Function)
// بله آپدیت‌ها را با POST به این آدرس می‌فرستد (هم‌شکل آپدیت‌های تلگرام).
// امکانات: دیکشنری آلمانی→فارسی و فارسی→آلمانی، تصویر هر کلمه، تلفظ صوتی، جعبه‌ی لایتنر، منوی دکمه‌ای.

import {
  sendMessage, answerCallbackQuery, inlineKeyboard, btn, urlBtn, replyKeyboard,
  sendPhotoBuffer,
} from '../lib/bale.js';
import {
  lookupGerman, formatEntry, lookupPersian, formatPersianResult, pluralText,
} from '../lib/dictionary.js';
import { generateImageBuffer, downloadImageBuffer, fetchCommonsPhotoUrl } from '../lib/media.js';
import { translateText, detectDirection, MAX_TEXT_CHARS } from '../lib/translate.js';
import { kv } from '../lib/store.js';
import {
  addCard, getCard, listCards, dueCards, answerCard, removeCard, MAX_BOX,
} from '../lib/leitner.js';

const HELP = `🇩🇪 دیکشنری آلمانی ⇄ فارسی

کلمه بفرستید و بگیرید:
• آرتیکل (der / die / das) و حالت جمع
• توضیح به آلمانی + معنی فارسی
• 🖼 تصویر کلمه — همه در یک پیام، با دکمه‌ی 🔊 تلفظ (عادی و آهسته)

از منوی پایین استفاده کنید:
📦 جعبه لایتنر — کلمه‌های ذخیره‌شده به ترتیب
🔁 مرور کلمات — مرور رسیده‌ها
🌐 تغییر زبان — جابه‌جایی بین «آلمانی ← فارسی» و «فارسی ← آلمانی»
📝 ترجمه متن — ترجمه‌ی جمله و پاراگراف (جهت خودکار تشخیص داده می‌شود)
نکته: اگر در هر حالتی جمله بفرستید (۴ کلمه یا بیشتر)، خودش به‌صورت متن ترجمه می‌شود.

در حالت فارسی ← آلمانی، همه‌ی معادل‌های آلمانی کلمه به ترتیب رواج نوشته می‌شوند.`;

// ----- حالت زبان هر کاربر: 'de' = آلمانی→فارسی | 'fa' = فارسی→آلمانی -----
const modeKey = (userId) => `mode:${userId}`;
const getMode = async (userId) => (await kv.getJSON(modeKey(userId)).catch(() => null)) || 'de';
const setMode = (userId, m) => kv.setJSON(modeKey(userId), m);

const menuKeyboard = (mode) => replyKeyboard([
  ['📦 جعبه لایتنر', '🔁 مرور کلمات'],
  [mode === 'fa' ? '🌐 ترجمه آلمانی به فارسی' : '🌐 ترجمه فارسی به آلمانی'],
  ['📝 ترجمه متن'],
]);

const lastKey = (userId) => `last:${userId}`;      // آخرین مدخل آلمانی (برای لایتنر/تلفظ)
const lastFaKey = (userId) => `lastfa:${userId}`;  // آخرین معادل‌های فارسی→آلمانی
const pendingKey = (userId) => `pending:${userId}`;

// ----- پیام واحد: عکس + متن در کپشن + دکمه‌ها (بدون پیام‌های جدا) -----
const CAPTION_LIMIT = 1000; // سقف امن کپشن عکس
const TTS_BASE = 'https://bale-german-dictionary-bot.vercel.app/api/tts?t=';
const ttsUrl = (speakText) => TTS_BASE + encodeURIComponent(speakText);
const speakOf = (e) => (e.article ? `${e.article} ${e.word}` : e.word);

/** بایت تصویر کلمه: اول عکس واقعی ویکی‌واژه، وگرنه تصویر ساخته‌شده از مفهوم درست */
async function getImageBuffer(entry, conceptOverride) {
  try {
    if (entry.image) {
      const buf = await downloadImageBuffer(entry.image);
      if (buf) return buf;
    }
    // دقت تصویر: برای اسم‌ها اول عکس واقعی از کامنز (با کنترل عنوان فایل)
    if (!entry.wordType || entry.wordType === 'Substantiv') {
      const url = await fetchCommonsPhotoUrl(conceptOverride || entry.english);
      if (url) {
        const buf = await downloadImageBuffer(url);
        if (buf) return buf;
      }
    }
    return await generateImageBuffer(entry.word, conceptOverride || entry.english, entry.wordType);
  } catch (err) {
    console.error('image error:', err);
    return null;
  }
}

/** نسخه‌ی فشرده‌ی مدخل برای وقتی متن کامل در کپشن جا نمی‌شود */
function formatEntryCompact(e) {
  const lines = [`🇩🇪 ${e.article ? e.article + ' ' : ''}${e.word}`];
  if (e.phonetic) lines.push(`🔊 ${e.phonetic}`);
  if (e.wordType === 'Substantiv') lines.push(`🔤 جمع: ${pluralText(e) || '—'}`);
  else if (e.wordType) lines.push(`🏷 نوع کلمه: ${e.wordType}`);
  if (e.definitions?.length) lines.push('', `📖 ${e.definitions[0]}`);
  if (e.persian) lines.push('', `🇮🇷 معنی فارسی: ${e.persian}`);
  if (e.examples?.length) lines.push('', `📝 مثال: ${e.examples[0]}`);
  return lines.join('\n');
}

/**
 * ارسال نتیجه: متن کامل همیشه می‌رسد (تمامی معانی).
 * اگر متن در کپشن جا شد: یک پیام واحد (عکس+متن+دکمه). اگر نشد: پیام متنی کامل + عکس جدا با دکمه‌ها.
 */
async function sendEntryMessage(chatId, entry, text, keyboard) {
  const buf = await getImageBuffer(entry);
  if (buf && text.length <= CAPTION_LIMIT) {
    const r = await sendPhotoBuffer(chatId, buf, text, keyboard);
    if (r?.ok) return;
  }
  await sendMessage(chatId, text, buf ? undefined : keyboard);
  if (buf) {
    await sendPhotoBuffer(chatId, buf,
      `🖼 ${entry.article ? entry.article + ' ' : ''}${entry.word}`, keyboard);
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
  const next = cur === 'de' ? 'fa' : 'de'; // از حالت متن هم به دیکشنری آلمانی برمی‌گردد
  await setMode(userId, next);
  await sendMessage(
    chatId,
    next === 'fa'
      ? '🌐 حالت عوض شد: حالا کلمه‌ی فارسی بفرستید، معادل‌های آلمانی‌اش را به ترتیب می‌گیرید.'
      : '🌐 حالت عوض شد: حالا کلمه‌ی آلمانی بفرستید، معنی فارسی + تصویر + تلفظ می‌گیرید.',
    menuKeyboard(next),
  );
}

/** ترجمه‌ی متن (جمله/پاراگراف) با تشخیص خودکار جهت */
async function handleTextTranslation(chatId, text) {
  if (text.length > MAX_TEXT_CHARS) {
    await sendMessage(chatId, `⚠️ متن طولانی است؛ حداکثر ${MAX_TEXT_CHARS} نویسه در هر پیام ترجمه می‌شود. متن را تکه‌تکه بفرستید.`);
    return;
  }
  const [from, to] = detectDirection(text);
  const r = await translateText(text, from, to);
  if (r.failed || !r.text) {
    await sendMessage(chatId, '⚠️ سرویس ترجمه در حال حاضر در دسترس نیست. چند دقیقه دیگر دوباره تلاش کنید.');
    return;
  }
  const header = from === 'de' ? '📝 ترجمه 🇩🇪 → 🇮🇷' : '📝 ترجمه 🇮🇷 → 🇩🇪';
  const body = `${header}\n\n${r.text}`;
  // پیام‌های خیلی بلند در چند بخش (سقف امن پیام بله)
  for (let i = 0; i < body.length; i += 3500) {
    await sendMessage(chatId, body.slice(i, i + 3500));
  }
}

async function handleGermanLookup(chatId, userId, text) {
  const entry = await lookupGerman(text);
  if (!entry.found) {
    await sendMessage(chatId, formatEntry(entry));
    return;
  }
  await kv.setJSON(lastKey(userId), entry);
  // یک پیام واحد: عکس + متن کامل در کپشن + دکمه‌ی لایتنر و دکمه‌ی تلفظ (لینک پخش‌کننده)
  const keyboard = inlineKeyboard([[
    btn('📦 افزودن به لایتنر', 'leitner:add'),
    urlBtn('🔊 تلفظ', ttsUrl(speakOf(entry))),
  ]]);
  await sendEntryMessage(chatId, entry, formatEntry(entry), keyboard);
}

async function handlePersianLookup(chatId, userId, text) {
  const result = await lookupPersian(text);
  if (!result.found) {
    await sendMessage(chatId, formatPersianResult(result));
    return;
  }
  await kv.setJSON(lastFaKey(userId), result.equivalents.map((eq) => eq.entry || { word: eq.de }));

  // همان امکانات جهت برعکس: برای هر معادل آرتیکل+جمع+معنی، دکمه‌ی تلفظ و لایتنر
  const lines = [`🇮🇷 ${result.word}`, '', '🇩🇪 معادل‌های آلمانی (به ترتیب رواج):'];
  result.equivalents.forEach((eq, i) => {
    const e = eq.entry;
    let line = `\n${i + 1}. ${e?.article ? e.article + ' ' : ''}${eq.de}`;
    const pl = pluralText(e);
    if (pl) line += ` — جمع: ${pl}`;
    if (e?.persian) line += ` (${e.persian})`;
    lines.push(line);
    // معادل اول توضیح آلمانی هم می‌گیرد — مثل جهت برعکس
    if (i === 0 && e?.definitions?.length) {
      lines.push(`📖 ${e.definitions.slice(0, 2).join('؛ ')}`);
    }
  });
  const fullText = lines.join('\n');

  const rows = result.equivalents.map((eq, i) => {
    const e = eq.entry || { word: eq.de };
    return [
      urlBtn(`🔊 ${eq.de}`, ttsUrl(speakOf(e))),
      btn(`📦 ${eq.de}`, `faadd:${i}`),
    ];
  });
  const keyboard = inlineKeyboard(rows);

  // تصویرِ معادلی که عکس واقعی دارد (وگرنه معادل اول) — متن کامل همیشه می‌رسد
  const withImage = result.equivalents.find((eq) => eq.entry?.image)?.entry;
  const first = withImage || result.equivalents[0]?.entry;
  const buf = first ? await getImageBuffer(first, result.englishConcept) : null;
  if (buf && fullText.length <= CAPTION_LIMIT) {
    const r = await sendPhotoBuffer(chatId, buf, fullText, keyboard);
    if (r?.ok) return;
  }
  await sendMessage(chatId, fullText, buf ? undefined : keyboard);
  if (buf && first) {
    await sendPhotoBuffer(chatId, buf,
      `🖼 ${first.article ? first.article + ' ' : ''}${first.word}`, keyboard);
  }
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
  if (text === '📝 ترجمه متن' || text === '/text') {
    await setMode(userId, 'text');
    await sendMessage(
      chatId,
      '📝 حالت ترجمه‌ی متن فعال شد.\nجمله یا پاراگراف بفرستید — آلمانی باشد به فارسی و فارسی باشد به آلمانی ترجمه می‌شود (تشخیص خودکار).\nبرای برگشتن به دیکشنری، دکمه‌ی 🌐 را بزنید.',
      menuKeyboard('text'),
    );
    return;
  }

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
  // حالت متن، یا جمله‌ی کامل در هر حالت (۴ کلمه به بالا) → ترجمه‌ی متن
  if (mode === 'text' || text.split(/\s+/).length >= 4) {
    await handleTextTranslation(chatId, text);
    return;
  }
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

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const userId = cb.from?.id ?? chatId;
  const data = cb.data || '';
  await answerCallbackQuery(cb.id);
  if (!chatId) return;

  if (data === 'cron:review') { await startReview(chatId, userId); return; }

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
