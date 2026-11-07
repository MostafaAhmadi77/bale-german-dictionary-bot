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

// صحنه‌های آماده برای فعل‌ها و صفت‌های قابل‌تصویر — پرامپتِ دستیِ یک صحنه‌ی مشخص،
// نه برگردانِ انتزاعیِ کلمه. (درس machen: از روی glossِ «make, do, perform» هیچ تصویر
// معناداری درنمی‌آید؛ خروجی شکل‌های بی‌ربط بود. صحنه‌ی «آدم در حال ساختن» جواب می‌دهد.)
const SCENE_PROMPTS = {
  machen: 'a person building a wooden chair with their hands in a workshop, tools on the table',
  gehen: 'a person walking along a path in a park',
  laufen: 'a person running fast on a running track',
  kommen: 'a person arriving at a house front door',
  essen: 'a person eating a meal at a table',
  trinken: 'a person drinking a glass of water',
  schlafen: 'a person sleeping peacefully in a bed',
  lesen: 'a person reading a book',
  schreiben: 'a hand writing in a notebook with a pen',
  kochen: 'a person cooking in a kitchen, stirring a pot on the stove',
  spielen: 'children playing with a ball in a park',
  arbeiten: 'a person working at a desk with a laptop',
  lernen: 'a student studying with open books at a desk',
  kaufen: 'a person buying bread at a bakery counter',
  verkaufen: 'a shopkeeper selling fruit at a market stall',
  fahren: 'a person driving a car',
  schwimmen: 'a person swimming in a swimming pool',
  tanzen: 'a couple dancing together',
  singen: 'a person singing into a microphone',
  lachen: 'a happy person laughing',
  weinen: 'a sad person crying, one tear on the cheek',
  sehen: 'a person looking through binoculars',
  hören: 'a person listening to music with headphones',
  sprechen: 'two people talking to each other face to face',
  öffnen: 'a person opening a wooden door',
  schließen: 'a person closing a window',
  sitzen: 'a person sitting on a chair',
  stehen: 'a person standing and waiting at a bus stop',
  liegen: 'a person lying on a bed, resting',
  helfen: 'one person helping an elderly person carry shopping bags',
  schnell: 'a cheetah running at full speed',
  langsam: 'a turtle walking slowly on grass',
};

/**
 * تصویر ساخته‌شده برای یک کلمه؛ seed از روی کلمه ثابت است تا تصویر هر کلمه پایدار بماند.
 * قانون ساختاری: برای فعل/صفت/قید (هر نوعی غیر از اسم) اگر صحنه‌ی آماده نداریم،
 * اصلا تصویر ساخته نمی‌شود (null) و پیام فقط متنی می‌رود — عکسِ اشتباه از نبودِ عکس بدتر است.
 * اسم‌ها از روی برگردان انگلیسی ساخته می‌شوند، چون معمولا شئِ مشخص‌اند.
 */
export async function generateImageBuffer(germanWord, englishGloss, wordType) {
  const scene = SCENE_PROMPTS[(germanWord || '').toLowerCase()];
  if (!scene && wordType && wordType !== 'Substantiv') return null;
  const prompt = encodeURIComponent(scene
    ? `simple educational flashcard illustration of this scene: ${scene}, one clear scene, plain background, no text, no letters, no words`
    : `simple educational flashcard illustration clearly representing the meaning of "${englishGloss || germanWord}", one clear scene or subject, plain background, no text, no letters, no words`);
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
