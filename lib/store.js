// Storage layer — Upstash Redis (REST) در تولید، حافظه (Map) در تست محلی.
// چرا Upstash؟ چون توابع ورسل serverless هستند و فایل/حافظه‌ی دائمی ندارند؛
// جعبه‌ی لایتنر باید بین اجراها و برای همه‌ی کاربران عمومی باقی بماند.

const URL_ = () => process.env.UPSTASH_REDIS_REST_URL;
const TOK = () => process.env.UPSTASH_REDIS_REST_TOKEN;
export const hasDb = () => Boolean(URL_() && TOK());

// ---------- In-memory fallback (local dev only) ----------
const mem = new Map();
const memSets = new Map();
const memCmd = (cmd, args) => {
  const [c, key, ...rest] = [cmd, ...args];
  switch (c) {
    case 'GET': return mem.get(key) ?? null;
    case 'SET': mem.set(key, rest[0]); return 'OK';
    case 'DEL': return mem.delete(key) ? 1 : 0;
    case 'SADD': {
      const s = memSets.get(key) ?? new Set(); s.add(rest[0]); memSets.set(key, s); return 1;
    }
    case 'SREM': {
      const s = memSets.get(key); return s && s.delete(rest[0]) ? 1 : 0;
    }
    case 'SMEMBERS': return [...(memSets.get(key) ?? [])];
    default: throw new Error(`mem: unsupported ${c}`);
  }
};

// ---------- Upstash REST ----------
async function redis(cmd, ...args) {
  if (!hasDb()) return memCmd(cmd, args);
  const res = await fetch(URL_(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOK()}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([cmd, ...args]),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) throw new Error(`Redis error: ${data.error}`);
  return data.result;
}

export const kv = {
  async getJSON(key) {
    const raw = await redis('GET', key);
    if (!raw) return null;
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  },
  async setJSON(key, value, exSeconds) {
    const raw = JSON.stringify(value);
    return exSeconds
      ? redis('SET', key, raw, 'EX', String(exSeconds))
      : redis('SET', key, raw);
  },
  del: (key) => redis('DEL', key),
  sadd: (key, member) => redis('SADD', key, member),
  srem: (key, member) => redis('SREM', key, member),
  smembers: async (key) => (await redis('SMEMBERS', key)) ?? [],
};
