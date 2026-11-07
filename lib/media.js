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
  const token = (englishGloss || '').split(',')[0].trim().replace(/^to\s+/i, '') || germanWord;
  const prompt = encodeURIComponent(scene
    ? `simple educational flashcard illustration of this scene: ${scene}, one clear scene, plain background, no text, no letters, no words`
    : `a clear realistic photograph of ${token}, single subject centered, plain neutral background, studio light, photorealistic, sharp focus, no text, no letters, no words, no watermark`);
  let seed = 0;
  for (const ch of germanWord) seed = (seed * 31 + ch.codePointAt(0)) % 100000;
  const url = `https://image.pollinations.ai/prompt/${prompt}?width=1024&height=768&nologo=true&seed=${seed}`;
  return fetchBuffer(url, 45000).catch(() => null);
}

/** دانلود عکس واقعی (ویکیمدیا) به‌صورت بایت */
export const downloadImageBuffer = (url) => fetchBuffer(url, 20000).catch(() => null);

/**
 * عکس استوک واقعی از Pixabay — نقطه‌ی قوتش فعل‌ها و صحنه‌های روزمره است
 * (همان جایی که کامنز کم می‌آورد). فقط وقتی کلید API در محیط باشد: PIXABAY_API_KEY
 */
export async function fetchPixabayPhotoUrl(englishGloss) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return null;
  const q = (englishGloss || '').split(',')[0].trim().replace(/^to\s+/i, '');
  if (!q) return null;
  const url = 'https://pixabay.com/api/?key=' + encodeURIComponent(key)
    + '&q=' + encodeURIComponent(q)
    + '&image_type=photo&safesearch=true&per_page=5&orientation=horizontal';
  const res = await fetch(url, { headers: UA }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  const hit = (data?.hits || []).find((h) => h.webformatURL || h.largeImageURL);
  return hit?.webformatURL || hit?.largeImageURL || null;
}

/**
 * جست‌وجوی عکس واقعی در Wikimedia Commons با برگردان انگلیسیِ حس اول.
 * دقت تصویر: عنوان فایل باید خودِ مفهوم را داشته باشد و نقشه/پرچم/لوگو/نمودار رد می‌شود؛
 * فقط عکس‌های واقعی (jpg/png) با عرض کافی برمی‌گردند.
 */
export async function fetchCommonsPhotoUrl(englishGloss) {
  const token = (englishGloss || '').split(',')[0].trim().replace(/^to\s+/i, '').split(/\s+/)[0]?.toLowerCase();
  if (!token || token.length < 3) return null;
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&generator=search&prop=imageinfo&format=json'
    + '&iiprop=url|size&iiurlwidth=1000&gsrnamespace=6&gsrlimit=10&gsrsearch='
    + encodeURIComponent(token);
  const res = await fetch(url, { headers: UA }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  const pages = Object.values(data?.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  const BAD = /map|karte|flag|wappen|coat of arms|logo|diagram|schema|poster|painting|drawing|illustration|icon|symbol|sign|document|stamp|coin|banknote/i;
  let vintage = null;
  for (const p of pages) {
    const title = (p.title || '').toLowerCase();
    const info = p.imageinfo?.[0];
    const fileUrl = info?.thumburl || info?.url;
    if (!fileUrl || !/\.(jpe?g|png)$/i.test(fileUrl.split('?')[0])) continue;
    if (BAD.test(title)) continue;
    if (!new RegExp(`(^|[^a-z])${token}([^a-z]|$)`).test(title)) continue;
    if (info.width && info.width < 500) continue;
    // پاک‌کردن پارامترهای ردیابی utm از انتهای آدرس عکس
    const clean = fileUrl.replace(/([?&])utm_[^&]*&?/g, '$1').replace(/[?&]$/, '');
    // عکس‌های قدیمی/پوسترهای وینتیج (سال در عنوان) اولویت آخرند
    if (/\b(18|19|20)\d{2}\b/.test(title)) { vintage ??= clean; continue; }
    return clean;
  }
  return vintage;
}

/**
 * عکس واقعی از Openverse (ایندکس عکس‌های آزاد فلیکر و…) — بدون نیاز به کلید.
 * برای اسم‌های روزمره‌ای که کامنز عکس تمیزی ندارد.
 */
export async function fetchOpenversePhotoUrl(englishGloss) {
  const q = (englishGloss || '').split(',')[0].trim().replace(/^to\s+/i, '');
  if (!q || q.length < 3) return null;
  const url = 'https://api.openverse.org/v1/images/?page_size=10&license_type=all&filter_dead=false&q='
    + encodeURIComponent(q);
  const res = await fetch(url, { headers: UA }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json().catch(() => null);
  for (const r of data?.results ?? []) {
    const title = (r.title || '').toLowerCase();
    if (/poster|logo|diagram|map|flag|icon|drawing|painting/i.test(title)) continue;
    if (r.width && r.width < 500) continue;
    // اول thumbnail (پروکسی خود Openverse) چون بعضی منبع‌ها مثل فلیکر هات‌لینک را 403 می‌دهند
    const u = r.thumbnail || r.url;
    if (u && /^https?:\/\//.test(u)) return u;
  }
  return null;
}

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
