// نقطه‌ی ورود ربات بله — وبهوک (Vercel Serverless Function)
// بله آپدیت‌ها را با POST به این آدرس می‌فرستد (هم‌شکل آپدیت‌های تلگرام).
// امکانات: دیکشنری آلمانی→فارسی و فارسی→آلمانی، تصویر هر کلمه، تلفظ صوتی، جعبه‌ی لایتنر، منوی دکمه‌ای.

import {
  sendMessage, sendAudioBuffer, answerCallbackQuery, inlineKeyboard, btn, replyKeyboard,
  sendPhotoBuffer,
} from '../lib/bale.js';
import {
  lookupGerman, formatEntry, lookupPersian, formatPersianResult, pluralText,
} from '../lib/dictionary.js';
import { generateImageBuffer, downloadImageBuffer, fetchCommonsPhotoUrl, fetchPixabayPhotoUrl, fetchTTSMp3 } from '../lib/media.js';
import { translateText, detectDirection, MAX_TEXT_CHARS } from '../lib/translate.js';
import { applyReview } from '../lib/ai-check.js';
import {
  newFeedbackId, addFeedback, getFeedback, listFeedback, updateFeedback,
  getAdminId, setAdminId,
} from '../lib/feedback.js';
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
💬 ارسال نظر و پیشنهاد — نظرتان مستقیم به دست سازنده می‌رسد و جوابش همینجا می‌آید
نکته: اگر در هر حالتی جمله بفرستید (۴ کلمه یا بیشتر)، خودش به‌صورت متن ترجمه می‌شود.

در حالت فارسی ← آلمانی، همه‌ی معادل‌های آلمانی کلمه به ترتیب رواج نوشته می‌شوند.`;

// ----- حالت زبان هر کاربر: 'de' = آلمانی→فارسی | 'fa' = فارسی→آلمانی -----
const modeKey = (userId) => `mode:${userId}`;
const getMode = async (userId) => (await kv.getJSON(modeKey(userId)).catch(() => null)) || 'de';
const setMode = (userId, m) => kv.setJSON(modeKey(userId), m);

const menuKeyboard = async (mode, userId) => {
  const rows = [
    ['📦 جعبه لایتنر', '🔁 مرور کلمات'],
    [mode === 'fa' ? '🌐 ترجمه آلمانی به فارسی' : '🌐 ترجمه فارسی به آلمانی'],
    ['📝 ترجمه متن'],
    ['💬 ارسال نظر و پیشنهاد'],
  ];
  // ردیف ادمین فقط برای خود ادمین دیده می‌شود
  const adminId = userId ? await getAdminId() : null;
  if (adminId && String(adminId) === String(userId)) rows.push(['📥 نظرات کاربران']);
  return replyKeyboard(rows);
};

const lastKey = (userId) => `last:${userId}`;      // آخرین مدخل آلمانی (برای لایتنر/تلفظ)
const lastFaKey = (userId) => `lastfa:${userId}`;  // آخرین معادل‌های فارسی→آلمانی
const pendingKey = (userId) => `pending:${userId}`;

// ----- پیام واحد: عکس + متن در کپشن + دکمه‌ها (بدون پیام‌های جدا) -----
const CAPTION_LIMIT = 1000; // سقف امن کپشن عکس
const speakOf = (e) => (e.article ? `${e.article} ${e.word}` : e.word);
// تلفظ داخل خود چت پخش می‌شود (بدون باز شدن هیچ سایتی): دکمه کال‌بک است و ربات
// فایل صدا را همان‌جا می‌فرستد. داده‌ی کال‌بک سقف ۶۴ بایت دارد؛ برای عبارت‌های
// خیلی بلند فقط پیشوند می‌رود و عبارت از آخرین مدخل خوانده می‌شود.
const ttsData = (prefix, phrase) =>
  (Buffer.byteLength(`${prefix}${phrase}`, 'utf8') <= 60 ? `${prefix}${phrase}` : prefix.slice(0, -1));

/** تصویر کلمه با نوع منبعش: {buf, kind} — kind برای حکم بازبینی AI لازم است */
async function getImageBuffer(entry, conceptOverride) {
  try {
    if (entry.image) {
      const buf = await downloadImageBuffer(entry.image);
      if (buf) return { buf, kind: 'entry' };
    }
    // دقت تصویر: برای اسم‌ها اول عکس واقعی از کامنز (با کنترل عنوان فایل)
    if (!entry.wordType || entry.wordType === 'Substantiv') {
      const url = await fetchCommonsPhotoUrl(conceptOverride || entry.english);
      if (url) {
        const buf = await downloadImageBuffer(url);
        if (buf) return { buf, kind: 'commons' };
      }
    }
    // عکس استوک Pixabay — برای همه‌ی نوع‌ها، مخصوصا فعل‌ها و صحنه‌ها (اگر کلید فعال باشد)
    const pixUrl = await fetchPixabayPhotoUrl(conceptOverride || entry.english);
    if (pixUrl) {
      const buf = await downloadImageBuffer(pixUrl);
      if (buf) return { buf, kind: 'pixabay' };
    }
    const gen = await generateImageBuffer(entry.word, conceptOverride || entry.english, entry.wordType);
    return gen ? { buf: gen, kind: 'generated' } : null;
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
async function sendEntryMessage(chatId, entry, text, keyboard, img) {
  const pic = img === undefined ? await getImageBuffer(entry) : img;
  const buf = pic?.buf ?? null;
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
    await menuKeyboard(next, userId),
  );
}

/** ترجمه‌ی متن (جمله/پاراگراف) با تشخیص خودکار جهت */
// ----- نظرات کاربران و صندوق ادمین -----
const isAdmin = async (userId) => {
  const a = await getAdminId();
  return a != null && String(a) === String(userId);
};
const senderName = (msg) => {
  const f = msg.from || {};
  return f.first_name || f.username || String(f.id ?? '');
};

async function promptFeedback(chatId, userId) {
  await kv.setJSON(pendingKey(userId), { fb: true }, 30 * 60);
  await sendMessage(chatId, '💬 نظر، پیشنهاد یا گزارش مشکلت را بنویس و بفرست؛ مستقیم به دست سازنده می‌رسد.\n(تا ۳۰ دقیقه فرصت داری؛ بعد از آن پیام بعدی‌ات جست‌وجوی عادی حساب می‌شود.)');
}

async function saveFeedbackFromUser(chatId, userId, msg, text) {
  await kv.del(pendingKey(userId));
  const item = await addFeedback({
    id: newFeedbackId(), userId, chatId,
    name: senderName(msg), text: String(text).slice(0, 2000),
    ts: Date.now(), status: 'new', reply: null, repliedAt: null,
  });
  await sendMessage(chatId, '✅ نظرت ثبت شد، ممنون! 🙏\nاگر پاسخی لازم باشد، همینجا برایت می‌آید.');
  // اطلاع لحظه‌ای به ادمین (اگر فعال شده باشد و فرستنده خودش نباشد)
  const adminId = await getAdminId();
  if (adminId && String(adminId) !== String(userId)) {
    await sendMessage(adminId,
      `💬 نظر تازه از ${item.name}:\n\n${item.text}`,
      inlineKeyboard([[btn('✍️ پاسخ به این نظر', `fbreply:${item.id}`)]])).catch(() => {});
  }
}

async function showInbox(chatId) {
  const items = await listFeedback(10);
  if (!items.length) { await sendMessage(chatId, '📥 هنوز نظری ثبت نشده است.'); return; }
  const lines = ['📥 آخرین نظرهای کاربران:', ''];
  items.forEach((it, i) => {
    const st = it.status === 'answered' ? '✅ پاسخ داده شد' : '🆕 بی‌پاسخ';
    lines.push(`${i + 1}. ${st} — ${it.name}:`);
    lines.push(it.text.length > 160 ? it.text.slice(0, 160) + '…' : it.text, '');
  });
  const rows = items.filter((it) => it.status !== 'answered')
    .map((it) => [btn(`✍️ پاسخ به ${it.name}`, `fbreply:${it.id}`)]);
  await sendMessage(chatId, lines.join('\n'), rows.length ? inlineKeyboard(rows) : undefined);
}

async function handleAdminCommand(chatId, userId, text) {
  const adminId = await getAdminId();
  if (!adminId) {
    // فعال‌سازی یک‌باره‌ی ادمین با رمز راه‌اندازی (همان SETUP_SECRET)
    const secret = text.split(/\s+/)[1];
    if (secret && process.env.SETUP_SECRET && secret === process.env.SETUP_SECRET) {
      await setAdminId(userId);
      await sendMessage(chatId, '👑 ادمین فعال شد! از این به بعد دکمه‌ی «📥 نظرات کاربران» را در منو داری و هر نظر تازه همان لحظه برایت می‌آید.', await menuKeyboard(await getMode(userId), userId));
      await showInbox(chatId);
    } else {
      await sendMessage(chatId, 'برای فعال‌سازی ادمین این‌طور بفرست:\n/admin <رمز راه‌اندازی>');
    }
    return;
  }
  if (String(adminId) !== String(userId)) {
    await sendMessage(chatId, 'این بخش فقط برای ادمین ربات است.');
    return;
  }
  await showInbox(chatId);
}

async function deliverAdminReply(chatId, userId, replyText) {
  const pending = await kv.getJSON(pendingKey(userId));
  await kv.del(pendingKey(userId));
  const item = pending?.fbreply ? await getFeedback(pending.fbreply) : null;
  if (!item) { await sendMessage(chatId, 'این نظر دیگر پیدا نشد.'); return; }
  const excerpt = item.text.length > 120 ? item.text.slice(0, 120) + '…' : item.text;
  await sendMessage(item.chatId,
    `📩 پاسخ به نظرت:\n\n${replyText}\n\n— نظر تو: «${excerpt}»`);
  await updateFeedback(item.id, { status: 'answered', reply: replyText, repliedAt: Date.now() });
  await sendMessage(chatId, `✅ پاسخت برای ${item.name} ارسال شد.`);
}

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
  // بازبینی AI قبل از ارسال (خواسته‌ی کاربر): تصویر و متن بررسی می‌شوند؛
  // نامرتبط‌ها حذف/اصلاح می‌شوند. بدون کلید Gemini یا هنگام خطا، نتیجه دست‌نخورده می‌رود.
  let img = await getImageBuffer(entry);
  img = await applyReview(entry, img,
    () => generateImageBuffer(entry.word, entry.english, entry.wordType));
  if (entry.aiReviewed) {
    // نسخه‌ی بازبینی‌شده در کش دیکشنری هم ذخیره می‌شود تا برای همه همان بیاید
    await kv.setJSON(`dict:v7:${entry.word.toLowerCase()}`, entry).catch(() => {});
  }
  await kv.setJSON(lastKey(userId), entry);
  // یک پیام واحد: عکس + متن کامل در کپشن + دکمه‌ی لایتنر و دکمه‌ی تلفظ (پخش داخل چت)
  const keyboard = inlineKeyboard([[
    btn('📦 افزودن به لایتنر', 'leitner:add'),
    btn('🔊 تلفظ', ttsData('tts:', speakOf(entry))),
  ]]);
  await sendEntryMessage(chatId, entry, formatEntry(entry), keyboard, img);
}

async function handlePersianLookup(chatId, userId, text) {
  const result = await lookupPersian(text);
  if (!result.found) {
    await sendMessage(chatId, formatPersianResult(result));
    return;
  }
  // تصویر + بازبینی AI قبل از ساخت متن، تا اصلاح‌ها در متن هم دیده شوند
  const withImage = result.equivalents.find((eq) => eq.entry?.image)?.entry;
  const first = withImage || result.equivalents[0]?.entry;
  let img = first ? await getImageBuffer(first, result.englishConcept) : null;
  if (first) {
    img = await applyReview(first, img,
      () => generateImageBuffer(first.word, result.englishConcept || first.english, first.wordType));
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
      btn(`🔊 ${eq.de}`, ttsData('tts:', speakOf(e))),
      btn(`📦 ${eq.de}`, `faadd:${i}`),
    ];
  });
  const keyboard = inlineKeyboard(rows);

  // تصویرِ بازبینی‌شده (متن کامل همیشه می‌رسد)
  const buf = img?.buf ?? null;
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
    await sendMessage(chatId, `سلام! 👋\n\n${HELP}`, await menuKeyboard(mode, userId));
    return;
  }
  if (text === '/help') { await sendMessage(chatId, HELP); return; }
  if (text === '/menu') {
    await sendMessage(chatId, 'منوی اصلی:', await menuKeyboard(await getMode(userId), userId));
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
      await menuKeyboard('text', userId),
    );
    return;
  }

  if (text === '💬 ارسال نظر و پیشنهاد' || text === '/feedback') { await promptFeedback(chatId, userId); return; }
  if (text === '📥 نظرات کاربران') {
    if (await isAdmin(userId)) await showInbox(chatId);
    else await sendMessage(chatId, 'این بخش فقط برای ادمین ربات است.');
    return;
  }
  if (text === '/admin' || text.startsWith('/admin ')) { await handleAdminCommand(chatId, userId, text); return; }

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

  // حالت‌های «در انتظار متن» (نظر کاربر / پاسخ ادمین) — پیش از هر مسیریابی دیگری مصرف می‌شوند،
  // چون نظرها معمولا جمله‌اند و نباید ترجمه یا جست‌وجو شوند.
  const pending = await kv.getJSON(pendingKey(userId)).catch(() => null);
  if (pending?.fb) { await saveFeedbackFromUser(chatId, userId, msg, text); return; }
  if (pending?.fbreply) {
    if (await isAdmin(userId)) { await deliverAdminReply(chatId, userId, text); return; }
    await kv.del(pendingKey(userId));
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

// تلفظ داخل چت: فایل صدا همان‌جا در گفت‌وگو فرستاده می‌شود و کاربر از بله خارج نمی‌شود.
// روی صدای عادی دکمه‌ی «🐌 تلفظ آهسته» هم می‌آید.
async function handleTts(chatId, userId, phrase, slow) {
  let text = (phrase || '').trim();
  if (!text) {
    const last = await kv.getJSON(lastKey(userId)).catch(() => null);
    if (last) text = speakOf(last);
  }
  if (!text) { await sendMessage(chatId, 'اول یک کلمه جست‌وجو کن، بعد تلفظش را بشنو.'); return; }
  const buf = await fetchTTSMp3(text, slow).catch(() => null);
  if (!buf) { await sendMessage(chatId, 'تلفظ الان در دسترس نیست؛ دوباره امتحان کن. 🙏'); return; }
  if (slow) {
    await sendAudioBuffer(chatId, buf, `🐌 تلفظ آهسته: ${text}`, text);
  } else {
    await sendAudioBuffer(chatId, buf, `🔊 تلفظ: ${text}`, text,
      inlineKeyboard([[btn('🐌 تلفظ آهسته', ttsData('ttss:', text))]]));
  }
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const userId = cb.from?.id ?? chatId;
  const data = cb.data || '';
  await answerCallbackQuery(cb.id);
  if (!chatId) return;

  if (data === 'tts' || data.startsWith('tts:')) { await handleTts(chatId, userId, data.slice(4), false); return; }
  if (data === 'ttss' || data.startsWith('ttss:')) { await handleTts(chatId, userId, data.slice(5), true); return; }
  if (data === 'cron:review') { await startReview(chatId, userId); return; }

  if (data.startsWith('fbreply:')) {
    if (!(await isAdmin(userId))) { await sendMessage(chatId, 'این بخش فقط برای ادمین ربات است.'); return; }
    const id = data.split(':')[1];
    const item = await getFeedback(id);
    if (!item) { await sendMessage(chatId, 'این نظر دیگر پیدا نشد.'); return; }
    await kv.setJSON(pendingKey(userId), { fbreply: id }, 30 * 60);
    await sendMessage(chatId, `✍️ پاسخ به نظر ${item.name}:\n«${item.text.slice(0, 200)}»\n\nپاسخت را بنویس و بفرست:`);
    return;
  }

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
