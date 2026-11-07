// صفحه‌ی پخش تلفظ — دکمه‌ی «🔊 تلفظ» در ربات این صفحه را باز می‌کند.
// دو پخش‌کننده دارد: سرعت عادی و سرعت آهسته. بدون ارسال فایل صوتی در چت.
// GET /api/tts?t=das+Haus            → صفحه‌ی HTML پخش‌کننده
// GET /api/tts?t=das+Haus&raw=1&s=0  → خود فایل MP3 (عادی)
// GET /api/tts?t=das+Haus&raw=1&s=1  → خود فایل MP3 (آهسته)

import { fetchTTSMp3 } from '../lib/media.js';

const cleanText = (t) => String(t || '')
  .replace(/[^\p{L}\p{M} .'-]/gu, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 60);

export default async function handler(req, res) {
  const text = cleanText(req.query?.t);
  if (!text) { res.status(400).send('متن تلفظ مشخص نیست'); return; }

  if (req.query?.raw) {
    const buf = await fetchTTSMp3(text, req.query?.s === '1');
    if (!buf) { res.status(502).send('تلفظ در دسترس نیست'); return; }
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(buf);
    return;
  }

  const enc = encodeURIComponent(text);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>تلفظ ${text}</title>
<style>body{font-family:Tahoma,sans-serif;background:#14181f;color:#eee;text-align:center;padding:28px 16px}
h1{color:#ffd54f;font-size:26px;direction:ltr} .lbl{margin:22px 0 6px;font-size:17px}
audio{width:92%;max-width:420px}</style></head>
<body>
<h1>🔊 ${text}</h1>
<div class="lbl">▶️ تلفظ عادی</div>
<audio controls preload="auto" src="/api/tts?t=${enc}&raw=1&s=0"></audio>
<div class="lbl">🐢 تلفظ آهسته</div>
<audio controls preload="auto" src="/api/tts?t=${enc}&raw=1&s=1"></audio>
</body></html>`);
}
