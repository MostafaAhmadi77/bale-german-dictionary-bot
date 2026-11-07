// تنظیم یک‌باره‌ی وبهوک + بررسی سلامت
// بعد از دیپلوی: GET https://<your-app>.vercel.app/api/setup?secret=<SETUP_SECRET>
// وبهوک را روی همین دامنه تنظیم می‌کند.

import { baleCall } from '../lib/bale.js';
import { hasDb } from '../lib/store.js';

export default async function handler(req, res) {
  if (req.query?.secret !== process.env.SETUP_SECRET) {
    res.status(401).json({ ok: false, error: 'bad secret' }); return;
  }
  // تغییر نام نمایشی ربات: /api/setup?secret=...&action=setname&name=...
  if (req.query?.action === 'setname') {
    const name = String(req.query?.name || '').slice(0, 64);
    const r = await baleCall('setMyName', { name });
    res.status(200).json({ ok: true, setMyName: r });
    return;
  }
  // تغییر عکس پروفایل ربات: /api/setup?secret=...&action=setphoto&img=<public image url>
  if (req.query?.action === 'setphoto') {
    const imgUrl = String(req.query?.img || '');
    const imgRes = await fetch(imgUrl).catch(() => null);
    if (!imgRes?.ok) { res.status(400).json({ ok: false, error: 'image fetch failed' }); return; }
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const form = new FormData();
    form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://profile' }));
    form.append('profile', new Blob([buf], { type: 'image/png' }), 'profile.png');
    const r = await fetch(`https://tapi.bale.ai/bot${process.env.BALE_BOT_TOKEN}/setMyProfilePhoto`, {
      method: 'POST', body: form,
    });
    const j = await r.json().catch(() => ({}));
    res.status(200).json({ ok: true, setMyProfilePhoto: j });
    return;
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
