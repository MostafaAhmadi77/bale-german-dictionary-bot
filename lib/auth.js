// سیستم احراز هویت ربات — فرم ثبت‌نام + تأیید ادمین + کلید روشن/خاموش برای ادمین.
// پیش‌فرض خاموش است. وقتی روشن شود، کاربر تازه باید فرم (نام، نام خانوادگی،
// شماره همراه، تاریخ تولد) را پر کند، خودش بررسی و تأیید کند، و بعد منتظر
// تأیید ادمین بماند. کاربرهای قدیمی هنگام روشن‌کردن خودکار تأیید می‌شوند.

import { kv } from './store.js';

const ENABLED = 'auth:enabled';
const PENDING = 'reg:pending';
const regKey = (id) => `reg:${id}`;

export const authEnabled = async () => (await kv.getJSON(ENABLED).catch(() => null)) === true;
export const setAuthEnabled = (v) => kv.setJSON(ENABLED, !!v);

export const getReg = (id) => kv.getJSON(regKey(id)).catch(() => null);
export const saveReg = (id, reg) => kv.setJSON(regKey(id), reg);

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
