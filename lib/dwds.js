// غنی‌سازی از DWDS (دیجیتالز وورتربوخ — دیکشنری آکادمیک آکادمی علوم برلین، dwds.de)
// صفحه‌ی مدخل (‎/wb/<word>‎) عمومی و بدون کلید است؛ از آن مثال‌های آموزشی و ترکیب‌های رایج را می‌خوانیم.
// این لایه فقط «غنی‌سازی» است: هر خطایی بی‌صدا رد می‌شود و مدخل اصلی (ویکی‌واژه) سر جایش می‌ماند.

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BaleGermanBot/1.0 (educational)' };

const stripHtml = (s) => (s || '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

function extractByClass(htmlText, cls, { min = 4, max = 170, limit = 4 } = {}) {
  const re = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</div>`, 'g');
  const out = [];
  for (const m of htmlText.matchAll(re)) {
    const t = stripHtml(m[1]);
    if (t.length >= min && t.length <= max && !out.includes(t)) out.push(t);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @returns {Promise<{examples: string[], collocations: string[]}|null>}
 */
export async function fetchDwds(word) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch('https://www.dwds.de/wb/' + encodeURIComponent(word), {
      headers: UA,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const htmlText = await res.text();
    if (!htmlText.includes('dwdswb')) return null;
    // مثال‌های آموزشی DWDS — جمله‌های ساخته‌شده برای زبان‌آموز
    // (تکه‌های استنادیِ دارای تاریخ/نام منبع حذف می‌شوند؛ جمله نیستند)
    const examples = extractByClass(htmlText, 'dwdswb-kompetenzbeispiel', { min: 8, limit: 6 })
      .filter((x) => !/DWDS|\d{2}\.\d{2}\.\d{4}/.test(x))
      .slice(0, 2);
    // ترکیب‌های رایج (Syntagmatik) — مثل «nach Hause» برای Haus
    const collocations = extractByClass(htmlText, 'dwdswb-syntagmatik', { min: 3, max: 120, limit: 4 })
      .map((c) => {
        let t = c.replace(/[⟨⟩]/g, '').replace(/\s+/g, ' ').trim();
        if (t.length > 55) t = t.slice(0, 55).replace(/\s+\S*$/, '') + '…';
        return t;
      })
      .filter((c) => c && !/^DWDS/.test(c));
    if (!examples.length && !collocations.length) return null;
    return { examples, collocations };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
