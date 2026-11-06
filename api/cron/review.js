// مرور خودکار روزانه — Vercel Cron (در vercel.json زمان‌بندی شده: هر روز 04:30 UTC = 08:00 تهران)
// برای هر کاربری که کارت رسیده دارد، یک پیام یادآوری با دکمه‌ی شروع مرور می‌فرستد.

import { sendMessage, inlineKeyboard, btn } from '../../lib/bale.js';
import { allUsers, dueCards } from '../../lib/leitner.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false }); return;
  }
  let notified = 0;
  try {
    const users = await allUsers();
    for (const userId of users) {
      const due = await dueCards(userId);
      if (!due.length) continue;
      await sendMessage(
        userId,
        `⏰ سلام! امروز ${due.length} کلمه در جعبه‌ی لایتنرت آماده‌ی مرور است.`,
        inlineKeyboard([[btn('🔁 شروع مرور', 'cron:review')]]),
      ).catch(() => {});
      notified++;
      if (notified >= 100) break; // سقف هر اجرا؛ بقیه اجرای فردا
    }
  } catch (err) {
    console.error('cron error:', err);
  }
  res.status(200).json({ ok: true, notified });
}
