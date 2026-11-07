// نظرات کاربران (فیدبک) — ذخیره در همان KV.
// هر نظر: {id, userId, chatId, name, text, ts, status: 'new'|'answered', reply, repliedAt}
// فهرست آیدی‌ها در fb:ids نگه داشته می‌شود (تازه‌ترین اول، سقف ۳۰۰).

import { kv } from './store.js';

const IDS_KEY = 'fb:ids';
const itemKey = (id) => `fb:${id}`;

export function newFeedbackId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function addFeedback(item) {
  await kv.setJSON(itemKey(item.id), item);
  const ids = (await kv.getJSON(IDS_KEY).catch(() => null)) || [];
  ids.unshift(item.id);
  await kv.setJSON(IDS_KEY, ids.slice(0, 300));
  return item;
}

export async function getFeedback(id) {
  return kv.getJSON(itemKey(id)).catch(() => null);
}

export async function listFeedback(limit = 10) {
  const ids = (await kv.getJSON(IDS_KEY).catch(() => null)) || [];
  const items = [];
  for (const id of ids.slice(0, limit)) {
    const it = await getFeedback(id);
    if (it) items.push(it);
  }
  return items;
}

export async function updateFeedback(id, patch) {
  const it = await getFeedback(id);
  if (!it) return null;
  Object.assign(it, patch);
  await kv.setJSON(itemKey(id), it);
  return it;
}

export const getAdminId = () => kv.getJSON('admin:id').catch(() => null);
export const setAdminId = (userId) => kv.setJSON('admin:id', userId);
