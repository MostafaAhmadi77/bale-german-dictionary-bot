// Bale Bot API client — https://tapi.bale.ai/bot<TOKEN>/<method>
// API بله هم‌شکل تلگرام است: متدها، آپدیت‌ها و دکمه‌های شیشه‌ای یکسان‌اند.

const token = () => {
  const t = process.env.BALE_BOT_TOKEN;
  if (!t) throw new Error('BALE_BOT_TOKEN is not set');
  return t;
};

export async function baleCall(method, payload = {}) {
  const res = await fetch(`https://tapi.bale.ai/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) {
    console.error(`Bale ${method} failed:`, JSON.stringify(data).slice(0, 400));
  }
  return data;
}

export const sendMessage = (chatId, text, replyMarkup) =>
  baleCall('sendMessage', {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

export const answerCallbackQuery = (callbackQueryId, text) =>
  baleCall('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
  }).catch(() => {});

/** ساخت دکمه‌های شیشه‌ای: rows = [[{text, callback_data}, ...], ...] */
export const inlineKeyboard = (rows) => ({ inline_keyboard: rows });
export const btn = (text, callback_data) => ({ text, callback_data });

/** منوی دکمه‌ای پایین صفحه (Reply Keyboard) */
export const replyKeyboard = (rows) => ({
  keyboard: rows.map((row) => row.map((text) => ({ text }))),
  resize_keyboard: true,
});

// ---------- آپلود فایل (عکس/صدا) با multipart ----------
async function baleUpload(method, chatId, field, buffer, filename, contentType, extra = {}) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append(field, new Blob([buffer], { type: contentType }), filename);
  for (const [k, v] of Object.entries(extra)) form.append(k, String(v));
  const res = await fetch(`https://tapi.bale.ai/bot${token()}/${method}`, {
    method: 'POST',
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error(`Bale ${method} upload failed:`, JSON.stringify(data).slice(0, 300));
  return data;
}

export const sendPhotoBuffer = (chatId, buffer, caption) =>
  baleUpload('sendPhoto', chatId, 'photo', buffer, 'image.jpg', 'image/jpeg',
    caption ? { caption } : {});

export const sendAudioBuffer = (chatId, buffer, caption, title) =>
  baleUpload('sendAudio', chatId, 'audio', buffer, 'pronunciation.mp3', 'audio/mpeg',
    { ...(caption ? { caption } : {}), ...(title ? { title } : {}), performer: 'Deutsch' });
