// ترجمه‌ی دسته‌ای معنی‌به‌معنی برای ساخت دیکشنری 33Bayan (ابزار داخلی، یک‌بارمصرف).
// فقط با هدر x-translate-token برابر TRANSLATE_TOKEN کار می‌کند.
const RULES = "Field rules:\n- fa: 1–3 natural Persian equivalents a translator would actually use for THIS sense (not the whole word), most common first. Standard modern Iranian Persian, with ZWNJ (نیم‌فاصله) where appropriate (می‌شود، کتاب‌ها). Verbs as infinitive (رفتن، خوشحال شدن). Nouns without article. Do not transliterate. Use fa_wiki only if it is correct for this sense; never copy old_fa blindly.\n- keep: false if the sense is only a heading/fragment (e.g. de = \"reflexiv:\" or \"transitiv, unpersönlich:\"), a duplicate of the previous sense, or a pure name/abbreviation note with no learner value. Still output the line with fa: [].\n- refl: \"akk\" (sich waschen, sich freuen), \"dat\" (sich etwas vorstellen, sich die Hände waschen), or null. Decide from tags reflexive, raw tags containing \"sich\", the definition text, AND your own knowledge of German. Many reflexive senses are not tagged; mark them correctly.\n- prep: governed preposition with case, e.g. \"auf+Akk\", \"über+Akk\", \"um+Akk\", \"an+Dat\", \"mit+Dat\", \"für+Akk\", or null. Only when typical for this sense.\n- frame: the short German usage pattern a learner should memorize (e.g. \"sich um jemanden kümmern\", \"jemandem etwas schenken\", \"Angst haben vor + Dat\") or null.\n- reg: one of \"umg\" (colloquial), \"geh\" (formal/elevated), \"derb\", \"österr\", \"schweiz\", \"veraltend\", \"fach\" or null.\n- domain: short English domain when the sense is specialist (e.g. \"finance\", \"law\", \"medicine\", \"biology\", \"tech\", \"military\", \"sport\"), else null.\n- ex_fa: natural Persian translation of the sense's German example if ex is non-empty, else null.\n\nQuality bar: this replaces a dictionary users complained about (wrong meanings, missing meanings, no reflexive info). Be accurate and idiomatic. Every sense in the input must appear exactly once in the output (match by w, e, i).\n\nExtra rule: if a source definition is truncated or garbled, still translate the sense from your own knowledge (keep=true). Never drop a core meaning a learner would expect (e.g. abnehmen = وزن کم کردن).\n";

const MODEL = process.env.TRANSLATE_MODEL || 'gemini-flash-latest';

function prompt(lines) {
  return `You are an expert German→Persian lexicographer building a learner dictionary (users are Iranian learners of German).
Input: JSON lines, one German headword each: {"w","old_fa","entries":[{"e","pos","g","forms","senses":[{"i","src_i","de","tags","raw","topics","ex","en","fa_wiki"}]}]}.
Return ONLY a JSON array with one object per SENSE (every (w,e,i) exactly once, i as string):
{"w","e","i","keep","fa":[...],"refl","prep","frame","reg","domain","ex_fa"}

${RULES}

INPUT:
${lines.map((l) => JSON.stringify(l)).join('\n')}`;
}

export default async function handler(req, res) {
  const tok = process.env.TRANSLATE_TOKEN;
  if (!tok || req.headers['x-translate-token'] !== tok) return res.status(401).json({ error: 'unauthorized' });
  if (req.method !== 'POST') return res.status(405).end();
  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'no key' });
  const lines = req.body?.lines;
  if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'lines required' });
  const model = req.body?.model || MODEL;
  const gen = { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens: 32000 };
  if (req.body?.thinking !== undefined) gen.thinkingConfig = { thinkingBudget: req.body.thinking };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt(lines) }] }], generationConfig: gen }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) return res.status(502).json({ error: 'gemini', status: r.status, detail: j?.error?.message?.slice(0, 300) });
  const text = j?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  let out;
  try { out = JSON.parse(text); } catch { return res.status(502).json({ error: 'bad json', finish: j?.candidates?.[0]?.finishReason, text: text.slice(0, 500) }); }
  return res.status(200).json({ model, usage: j?.usageMetadata, senses: out });
}
