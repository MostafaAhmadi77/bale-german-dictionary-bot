// تنظیم یک‌باره‌ی وبهوک + بررسی سلامت
// بعد از دیپلوی: GET https://<your-app>.vercel.app/api/setup?secret=<SETUP_SECRET>
// وبهوک را روی همین دامنه تنظیم می‌کند.

import { baleCall } from '../lib/bale.js';
import { hasDb } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.query?.secret !== process.env.SETUP_SECRET) {
    res.status(401).json({ ok: false, error: 'bad secret' }); return;
  }
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const qs = process.env.WEBHOOK_SECRET ? `?s=${encodeURIComponent(process.env.WEBHOOK_SECRET)}` : '';
  const webhookUrl = `https://${host}/api/webhook${qs}`;
  const [me, wh] = await Promise.all([
    baleCall('getMe'),
    baleCall('setWebhook', { url: webhookUrl }),
  ]);
  res.status(200).json({
    ok: true,
    bot: me.result ?? me,
    webhook: wh,
    webhookUrl,
    database: hasDb() ? 'upstash' : 'memory (NOT persistent — set UPSTASH_*)',
  });
}
