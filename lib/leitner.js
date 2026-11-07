// Leitner box — جعبه‌ی لایتنر
// هر کارت: کلمه + مدخل دیکشنری، شماره‌ی خانه (۱ تا ۵)، بازه‌ی پایه‌ای که کاربر انتخاب کرده
// و زمان مرور بعدی.
// «بلدم ✅»  -> یک خانه بالاتر؛ فاصله‌ی مرور = بازه‌ی پایه × ۲^(خانه-۱) (سقف ۶۰ روز)
// «بلد نیستم ❌» -> برگشت به خانه‌ی ۱؛ مرور بعدی = بازه‌ی پایه

import { kv } from './store.js';

const DAY = 24 * 3600 * 1000;
export const MAX_BOX = 5;

const cardKey = (userId, cardId) => `card:${userId}:${cardId}`;
const userCardsKey = (userId) => `cards:${userId}`;
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export const intervalFor = (baseDays, box) =>
  Math.min(baseDays * 2 ** (box - 1), 60);

export async function addCard(userId, entry, baseDays) {
  const cardId = newId();
  const now = Date.now();
  const card = {
    id: cardId,
    word: entry.word,
    entry,
    box: 1,
    baseDays,
    createdAt: now,
    nextReviewAt: now + baseDays * DAY, // اولین مرور بعد از بازه‌ی انتخابی کاربر
  };
  await kv.setJSON(cardKey(userId, cardId), card);
  await kv.sadd(userCardsKey(userId), cardId);
  await kv.sadd('users', String(userId));
  return card;
}

export async function getCard(userId, cardId) {
  return kv.getJSON(cardKey(userId, cardId));
}

export async function listCards(userId, sortBy = 'due') {
  const ids = await kv.smembers(userCardsKey(userId));
  const cards = await Promise.all(ids.map((id) => getCard(userId, id)));
  const valid = cards.filter(Boolean);
  // 'created' = به ترتیب اضافه شدن (برای نمایش منو) | 'due' = به ترتیب زمان مرور
  return sortBy === 'created'
    ? valid.sort((a, b) => a.createdAt - b.createdAt)
    : valid.sort((a, b) => a.nextReviewAt - b.nextReviewAt);
}

export async function dueCards(userId, now = Date.now()) {
  const all = await listCards(userId);
  return all.filter((c) => c.nextReviewAt <= now);
}

export async function answerCard(userId, cardId, known) {
  const card = await getCard(userId, cardId);
  if (!card) return null;
  const now = Date.now();
  if (known) {
    card.box = Math.min(card.box + 1, MAX_BOX);
  } else {
    card.box = 1;
  }
  card.nextReviewAt = now + intervalFor(card.baseDays, card.box) * DAY;
  card.lastAnswerAt = now;
  await kv.setJSON(cardKey(userId, cardId), card);
  return card;
}

export async function removeCard(userId, cardId) {
  await kv.del(cardKey(userId, cardId));
  await kv.srem(userCardsKey(userId), cardId);
}

export async function allUsers() {
  return kv.smembers('users');
}

const faDate = (ts) =>
  new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium' }).format(new Date(ts));

export function formatCardList(cards) {
  if (!cards.length) return '📦 جعبه‌ی لایتنرت خالی است.\nیک کلمه جست‌وجو کن و دکمه‌ی «افزودن به لایتنر» را بزن.';
  const lines = ['📦 جعبه‌ی لایتنر شما:', ''];
  for (const c of cards) {
    const due = c.nextReviewAt <= Date.now() ? '⏰ وقت مرورش رسیده!' : `مرور بعدی: ${faDate(c.nextReviewAt)}`;
    lines.push(`• ${c.entry.article ? c.entry.article + ' ' : ''}${c.word} — خانه‌ی ${c.box} از ${MAX_BOX} — ${due}`);
  }
  return lines.join('\n');
}
