// بازبینی هوش مصنوعی قبل از ارسال نتیجه (خواسته‌ی کاربر):
// قبل از این‌که نتیجه به کاربر برسد، یک مدل چشمی (Gemini) متن و تصویر را بررسی می‌کند:
//  - تصویر نامرتبط => حذف (عکس واقعیِ اشتباه با تصویر ساخته‌شده جایگزین، تصویر ساخته‌شده‌ی اشتباه حذف)
//  - تعریف/مثال زائد یا نامرتبط => حذف از متن
//  - معنی فارسیِ اشتباه (فقط وقتی از منبع ضعیف آمده، نه ترجمه‌ی خودِ مدخل ویکی‌واژه) => اصلاح با پیشنهاد مدل
// فقط وقتی فعال است که GEMINI_API_KEY در محیط باشد. کاملا fail-open است:
// هر خطا، تأخیر یا پاسخ نامعتبر => null و نتیجه‌ی اصلی بدون تغییر ارسال می‌شود.

// مدل‌های پین‌شده (2.5-flash و…) برای حساب‌های جدید بسته‌اند («no longer available to new users»)
// و alias سنگینِ flash-latest یک بار ۴۳ ثانیه طول کشید؛ نسخه‌ی lite بدون thinkingConfig
// با همان کلید در ~۲ ثانیه حکم دقیق داد. سرعت این لایه حیاتی است: کاربر منتظر نتیجه است.
const MODEL = 'gemini-flash-lite-latest';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

function imageMime(buf) {
  if (!buf?.length) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF') return 'image/webp';
  return null;
}

/** پیشنهاد معنی فارسی مدل فقط اگر کوتاه، فارسی و غیرجمله‌ای باشد پذیرفته می‌شود */
export function saneFaSuggestion(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t.length >= 2 && t.length <= 60
    && /[\u0600-\u06FF]/.test(t)
    && !/[A-Za-z]/.test(t)
    && !/[.!?؟۔]/.test(t);
}

function buildPrompt(entry) {
  const defs = (entry.definitions || []).map((d, i) => `${i}: ${d}`).join('\n');
  const exs = (entry.examples || []).map((x, i) => `${i}: ${x}`).join('\n');
  return [
    'You are a strict quality reviewer for a German→Persian learner dictionary bot.',
    'Check the entry below (and the attached image, if any) and answer with ONLY a JSON object.',
    '',
    `German word: ${entry.word}`,
    `Word type: ${entry.wordType || 'unknown'}${entry.article ? `, article: ${entry.article}` : ''}${entry.plural ? `, plural: ${entry.plural}` : ''}`,
    `English gloss: ${entry.english || '-'}`,
    `Persian meaning shown to users: ${entry.persian || '(none)'}`,
    'German definitions (numbered):',
    defs || '(none)',
    'Example sentences (numbered):',
    exs || '(none)',
    '',
    'Rules:',
    '- imageRelevant: true if the image clearly depicts the main meaning of the German word (for verbs: the action; for adjectives: a scene showing the quality). false if it shows something unrelated, a wrong object/action, text, a logo, or a person posing without context. Also false if an everyday object is shown as an abstract, distorted or artistic sculpture/rendering instead of the real object, or if the image contains garbled fake letters or unreadable pseudo-text. null if no image attached.',
    '- persianOk: true if the Persian meaning is a correct translation of the German word (any main sense). false only if it is clearly a different word/meaning.',
    '- suggestedPersian: if persianOk is false, give the correct short Persian equivalent (infinitive form for verbs, e.g. رفتن). Otherwise null.',
    '- removeDefinitions: indexes of definitions that are NOT definitions of this word (junk, wrong homonym sense from another word, empty shells).',
    '- removeExamples: indexes of examples that are not German sentences or are unrelated to this word.',
    'Be conservative: when in doubt, keep the item. Answer with ONLY this JSON:',
    '{"imageRelevant": true, "persianOk": true, "suggestedPersian": null, "removeDefinitions": [], "removeExamples": []}',
  ].join('\n');
}

/**
 * @returns {Promise<{imageRelevant: boolean|null, persianOk: boolean, suggestedPersian: string|null,
 *                    removeDefinitions: number[], removeExamples: number[]}|null>}
 */
export async function aiReview(entry, imageBuffer) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const parts = [{ text: buildPrompt(entry) }];
  const mime = imageMime(imageBuffer);
  if (mime) {
    parts.push({ inlineData: { mimeType: mime, data: imageBuffer.toString('base64') } });
  }
  const body = JSON.stringify({
    contents: [{ parts }],
    // توجه: thinkingConfig روی مدل lite خطای 400 می‌دهد — اصلا فرستاده نمی‌شود
    generationConfig: { temperature: 0, maxOutputTokens: 800 },
  });
  // یک تلاش مجدد روی خطاهای گذرای گوگل (503 شلوغی مدل / 429) — در عمل دیده شد
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        signal: ctrl.signal,
        body,
      });
    } catch {
      res = null;
    } finally {
      clearTimeout(timer);
    }
    if (res?.ok) break;
    if (attempt === 0 && (res === null || res.status === 503 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    return null;
  }
  try {
    if (!res?.ok) return null;
    const data = await res.json().catch(() => null);
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const v = JSON.parse(m[0]);
    const idxList = (a, max) => Array.isArray(a)
      ? [...new Set(a.filter((n) => Number.isInteger(n) && n >= 0 && n < max))]
      : [];
    return {
      imageRelevant: typeof v.imageRelevant === 'boolean' ? v.imageRelevant : null,
      persianOk: v.persianOk !== false,
      suggestedPersian: typeof v.suggestedPersian === 'string' ? v.suggestedPersian : null,
      removeDefinitions: idxList(v.removeDefinitions, (entry.definitions || []).length),
      removeExamples: idxList(v.removeExamples, (entry.examples || []).length),
    };
  } catch {
    return null;
  }
}

/**
 * اعمال حکم بازبینی روی مدخل و تصویر.
 * @param entry مدخل (درجا اصلاح می‌شود)
 * @param img {{buf: Buffer, kind: string}|null}
 * @param generateReplacement {() => Promise<Buffer|null>} سازنده‌ی تصویر جایگزین
 * @returns {Promise<{buf: Buffer, kind: string}|null>} تصویر نهایی
 */
export async function applyReview(entry, img, generateReplacement) {
  // کلمه‌ای که قبلا بازبینی و در کش ذخیره شده، همان نسخه‌ی بازبینی‌شده است؛
  // بازبینیِ دوباره فقط سرعت را می‌کشد (درس کندی v9: هر جست‌وجو یک فراخوان کامل AI می‌خورد)
  if (entry.aiReviewed) return img;
  const verdict = await aiReview(entry, img?.buf ?? null).catch(() => null);
  if (!verdict) return img;
  if (!entry.aiReviewed) {
    if (verdict.removeDefinitions.length && entry.definitions?.length) {
      entry.definitions = entry.definitions.filter((_, i) => !verdict.removeDefinitions.includes(i));
    }
    if (verdict.removeExamples.length && entry.examples?.length) {
      entry.examples = entry.examples.filter((_, i) => !verdict.removeExamples.includes(i));
    }
    // معنیِ برگرفته از خودِ مدخل ویکی‌واژه دست نمی‌خورد؛ اصلاح فقط برای منابع پشتیبان است
    if (verdict.persianOk === false && entry.faSource !== 'wiktionary'
        && saneFaSuggestion(verdict.suggestedPersian)) {
      entry.persian = verdict.suggestedPersian.trim();
    }
    entry.aiReviewed = true;
  }
  if (verdict.imageRelevant === false && img?.buf) {
    if (img.kind === 'generated') return null; // تصویر ساخته‌شده‌ی نامرتبط: حذف کامل
    const gen = generateReplacement ? await generateReplacement().catch(() => null) : null;
    return gen ? { buf: gen, kind: 'generated' } : null; // عکس واقعیِ نامرتبط: یک جایگزین ساخته‌شده
  }
  return img;
}
