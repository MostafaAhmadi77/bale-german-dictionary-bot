// سیستم احراز هویت ربات — فرم ثبت‌نام + تأیید ادمین + کلید روشن/خاموش برای ادمین.
// پیش‌فرض خاموش است. وقتی روشن شود، کاربر تازه باید فرم (نام، نام خانوادگی،
// شماره همراه، تاریخ تولد) را پر کند، خودش بررسی و تأیید کند، و بعد منتظر
// تأیید ادمین بماند. کاربرهای قدیمی هنگام روشن‌کردن خودکار تأیید می‌شوند.

import { kv } from './store.js';

const ENABLED = 'auth:enabled';
const PENDING = 'reg:pending';
const IDS = 'reg:ids';
const regKey = (id) => `reg:${id}`;

export const authEnabled = async () => (await kv.getJSON(ENABLED).catch(() => null)) === true;
export const setAuthEnabled = (v) => kv.setJSON(ENABLED, !!v);

export const getReg = (id) => kv.getJSON(regKey(id)).catch(() => null);

export async function saveReg(id, reg) {
  await kv.setJSON(regKey(id), reg);
  // نمایه‌ی همه‌ی ثبت‌نام‌ها برای فهرست‌کردن کاربران تأییدشده
  const ids = (await kv.getJSON(IDS).catch(() => null)) || [];
  if (!ids.map(String).includes(String(id))) {
    ids.push(id);
    await kv.setJSON(IDS, ids.slice(-1000));
  }
}

/** همه‌ی کاربران تأییدشده (فرم‌دارها تازه‌تر اول؛ قدیمی‌های بدون فرم آخر) */
export async function listApproved() {
  const fromIndex = (await kv.getJSON(IDS).catch(() => null)) || [];
  const fromUsers = await kv.smembers('users').catch(() => []);
  const ids = [...new Set([...fromIndex.map(String), ...fromUsers.map(String)])];
  const out = [];
  for (const id of ids) {
    const r = await getReg(id);
    if (r?.status === 'approved') out.push({ userId: id, ...r });
  }
  out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  return out;
}

export async function addPending(id) {
  const a = (await kv.getJSON(PENDING).catch(() => null)) || [];
  if (!a.map(String).includes(String(id))) {
    a.unshift(id);
    await kv.setJSON(PENDING, a.slice(0, 300));
  }
}

export async function removePending(id) {
  const a = (await kv.getJSON(PENDING).catch(() => null)) || [];
  await kv.setJSON(PENDING, a.filter((x) => String(x) !== String(id)));
}

export async function listPendingRegs() {
  const ids = (await kv.getJSON(PENDING).catch(() => null)) || [];
  const out = [];
  for (const id of ids) {
    const r = await getReg(id);
    if (r?.status === 'pending') out.push({ userId: id, ...r });
  }
  return out.slice(0, 10);
}

/** کاربرهای فعلی ربات (مجموعه‌ی users) هنگام روشن‌شدن سیستم خودکار تأیید می‌شوند */
export async function grandfatherExistingUsers() {
  const ids = await kv.smembers('users').catch(() => []);
  let n = 0;
  for (const id of ids) {
    const r = await getReg(id);
    if (!r) {
      await saveReg(id, { status: 'approved', legacy: true, ts: Date.now() });
      n++;
    }
  }
  return n;
}
