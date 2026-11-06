// نقطه‌ی ورود ربات بله — وبهوک (Vercel Serverless Function)
// بله آپدیت‌ها را با POST به این آدرس می‌فرستد (هم‌شکل آپدیت‌های تلگرام).

import { sendMessage, answerCallbackQuery, inlineKeyboard, btn } from '../lib/bale.js';
import { lookupGerman, formatEntry } from '../lib/dictionary.js';
import { kv } from '../lib/store.js';
import {
  addCard, getCard, listCards, dueCards, answerCard, removeCard, formatCardList, MAX_BOX,
} from '../lib/leitner.js';

const HELP = `🇩🇪 دیکشنری آلمانی به فارسی

فقط کلمه‌ی آلمانی را بفرستید؛ در جواب می‌گیرید:
• آرتیکل (der / die / das) و حالت جمع
• توضیح کلمه به زبان آلمانی
• معنی فارسی

دستورها:
/start — شروع
/help — همین راهنما
/mywords — کلمه‌های جعبه‌ی لایتنر
/review — مرور کلمه‌هایی که وقتشان رسیده
/due — چند کلمه امروز برای مرور داری؟

📦 لایتنر: بعد از هر جست‌وجو دکمه‌ی «افزودن به لایتنر» را بزنید و انتخاب کنید هر چند روز یک‌بار مرور شود. ربات سر وقت خودش کلمه را برای مرور می‌فرستد.`;

const lastKey = (userId) => `last:${userId}`;
const pendingKey = (userId) => `pending:${userId}`;

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
    inlineKeyboard([[
      btn('👀 نمایش معنی', `rev:show:${card.id}`),
    ]]),
  );
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const userId = msg.from?.id ?? chatId;
  const text = (msg.text || '').trim();
  if (!chatId || !text) return;

  if (text === '/start') {
    await sendMessage(chatId, `سلام! 👋\n\n${HELP}`);
    return;
  }
  if (text === '/help') { await sendMessage(chatId, HELP); return; }

  if (text === '/mywords') {
    await sendMessage(chatId, formatCardList(await listCards(userId)));
    return;
  }
  if (text === '/review') { await startReview(chatId, userId); return; }
  if (text === '/due') {
    const due = await dueCards(userId);
    await sendMessage(chatId, due.length
      ? `⏰ امروز ${due.length} کلمه برای مرور داری. با /review شروع کن.`
      : '🎉 امروز چیزی برای مرور نداری.');
    return;
  }
  if (text.startsWith('/')) {
    await sendMessage(chatId, 'دستور ناشناخته است. /help را ببین.');
    return;
  }

  // جست‌وجوی کلمه
  const entry = await lookupGerman(text);
  await sendMessage(
    chatId,
    formatEntry(entry),
    entry.found
      ? inlineKeyboard([[btn('📦 افزودن به لایتنر', 'leitner:add')]])
      : undefined,
  );
  if (entry.found) await kv.setJSON(lastKey(userId), entry);
}

async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id;
  const userId = cb.from?.id ?? chatId;
  const data = cb.data || '';
  await answerCallbackQuery(cb.id);
  if (!chatId) return;

  if (data === 'cron:review') { await startReview(chatId, userId); return; }

  // افزودن آخرین کلمه‌ی جست‌وجوشده به لایتنر -> انتخاب بازه‌ی مرور توسط کاربر
  if (data === 'leitner:add') {
    const entry = await kv.getJSON(lastKey(userId));
    if (!entry) { await sendMessage(chatId, 'اول یک کلمه جست‌وجو کن.'); return; }
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

  // مرور: نمایش معنی
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
    await startReview(chatId, userId); // کارت بعدیِ رسیده
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
  // بله مثل تلگرام: همیشه 200 بده تا آپدیت دوباره ارسال نشود
  res.status(200).json({ ok: true });
}
