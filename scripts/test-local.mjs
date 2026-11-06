// تست محلی بدون بله و بدون ورسل:  npm test
// ۱) جست‌وجوی واقعی در ویکی‌واژه برای Haus و Wasser و یک فعل (gehen)
// ۲) چرخه‌ی لایتنر: افزودن کارت با بازه‌ی ۱ روز، رسیده شدن، پاسخ «بلدم» و رفتن به خانه‌ی ۲

import { lookupGerman, formatEntry } from '../lib/dictionary.js';
import { addCard, dueCards, answerCard, listCards } from '../lib/leitner.js';

let failed = 0;
const check = (name, cond) => {
  console.log(`${cond ? '✅' : '❌'} ${name}`);
  if (!cond) failed++;
};

for (const w of ['Haus', 'Wasser', 'gehen']) {
  const e = await lookupGerman(w);
  console.log('\n-----', w, '-----\n' + formatEntry(e));
  check(`${w}: found`, e.found);
  if (w === 'Haus') {
    check('Haus: article das', e.article === 'das');
    check('Haus: plural Häuser', e.plural === 'Häuser');
    check('Haus: persian خانه', (e.persian || '').includes('خانه'));
  }
  if (w === 'Wasser') check('Wasser: article das', e.article === 'das');
}

// --- Leitner ---
const user = 'test-user';
const entry = await lookupGerman('Haus');
const card = await addCard(user, entry, 1);
check('leitner: card in box 1', card.box === 1);
check('leitner: not due yet', (await dueCards(user)).length === 0);
// وانمود می‌کنیم زمان مرور رسیده
card.nextReviewAt = Date.now() - 1000;
const { kv } = await import('../lib/store.js');
await kv.setJSON(`card:${user}:${card.id}`, card);
check('leitner: due after time passes', (await dueCards(user)).length === 1);
const after = await answerCard(user, card.id, true);
check('leitner: known -> box 2', after.box === 2);
check('leitner: list has 1 card', (await listCards(user)).length === 1);

console.log(failed ? `\n❌ ${failed} تست رد شد` : '\n🎉 همه‌ی تست‌ها پاس شدند');
process.exit(failed ? 1 : 0);
