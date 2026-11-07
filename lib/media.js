// ساخت تصویر با هوش مصنوعی (Pollinations — رایگان، بدون کلید) و تلفظ آلمانی (Google TTS)
// هر دو از داخل تابع ورسل صدا زده می‌شوند و خروجی بایتی می‌دهند تا با آپلود چندبخشی به بله فرستاده شوند.

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BaleGermanBot/1.0' };

async function fetchBuffer(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/** تصویر ساخته‌شده برای یک مفهوم؛ seed از روی کلمه ثابت است تا تصویر هر کلمه پایدار بماند */
export async function generateImageBuffer(germanWord, englishGloss) {
  const concept = englishGloss || germanWord;
  const prompt = encodeURIComponent(
    `clear educational flashcard photograph of ${concept}, single main subject, simple clean background, bright, no text`);
  let seed = 0;
  for (const ch of germanWord) seed = (seed * 31 + ch.codePointAt(0)) % 100000;
  const url = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=768&nologo=true&seed=${seed}`;
  return fetchBuffer(url, 45000).catch(() => null);
}

/** دانلود عکس واقعی (ویکیمدیا) به‌صورت بایت */
export const downloadImageBuffer = (url) => fetchBuffer(url, 20000).catch(() => null);

/**
 * تلفظ آلمانی با صدای گوگل — طبیعی و واضح.
 * slow=true سرعت را خیلی کم می‌کند (ttsspeed=0.3) تا کلمه آهسته و شمرده خوانده شود.
 */
export async function fetchTTSMp3(text, slow = false) {
  const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=de&q='
    + encodeURIComponent(text) + (slow ? '&ttsspeed=0.3' : '');
  const buf = await fetchBuffer(url, 20000).catch(() => null);
  // پاسخ معتبر MP3 است؛ صفحه‌های خطا/محدودیت HTML هستند و رد می‌شوند
  return buf && buf.length > 1000 && buf[0] !== 0x3c ? buf : null;
}
