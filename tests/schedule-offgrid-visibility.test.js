import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDayViewFixture, readRenderedCards } from './fixtures/render-day-view.js';
import { buildDayBookingIndex } from '../src/schedule-day-index.js';

test('混合真重疊與非整刻連堂：保留原本第一筆的優先權', () => {
  const bookings = [
    { id: 'A', space: 2, time: '13:05', duration: 90 },
    { id: 'C', space: 2, time: '14:30', duration: 60 },
    { id: 'B', space: 2, time: '14:40', duration: 60 },
  ];
  const slots = buildDayBookingIndex(bookings, 60).get(2);
  assert.equal(slots[22]?.id, 'A', '14:30 格不可因 B 而從 A 改成 C');
  for (let slot = 0; slot < 60; slot++) {
    const expected = bookings.find(b => {
      const [hour, minute] = b.time.split(':').map(Number);
      const start = hour * 60 + minute - 540;
      return Math.floor(start / 15) <= slot && slot < Math.ceil((start + b.duration) / 15);
    });
    assert.equal(slots[slot], expected, `slot=${slot} 保留舊 first-match`);
  }
});

const chain = [
  { id: 'previous', space: 2, owner: '史昕銓', kind: 'coach', time: '13:05', duration: 60, bufferMinutes: 5 },
  { id: 'hidden', space: 2, owner: '史昕銓', kind: 'coach', time: '14:10', duration: 60, bufferMinutes: 15 },
  { id: 'following', space: 2, owner: '史昕銓', kind: 'coach', time: '15:25', duration: 60, bufferMinutes: 5 },
];

test('非整刻連堂：13:05 後的 14:10 與 15:25 卡片皆顯示，前堂仍保留完整課程與緩衝', () => {
  const cards = readRenderedCards(renderDayViewFixture(chain));
  assert.deepEqual(cards.map(c => c.id), ['previous', 'hidden', 'following']);
  const first = cards[0];
  assert.equal(first.rowspan, 4, '前堂表格格數須讓出下一堂所在的 14:00 格');
  assert.equal(first.spacerHeight, 10);
  assert.equal(first.mainHeight, 120, '讓出表格格線不能裁掉實際課程');
  assert.deepEqual(first.tail, { top: 130, height: 10 });
  assert.equal(cards[1].spacerHeight, 20, '14:10 仍使用正確的分鐘偏移');
});

test('不同起點與緩衝的合法連堂，輸入倒序也不漏卡片、不裁切課程', () => {
  const clock = offset => {
    const total = 9 * 60 + offset;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  for (const start of [0, 5, 10]) {
    for (const buffer of [0, 5, 10, 15]) {
      const bookings = Array.from({ length: 4 }, (_, i) => ({
        id: `chain-${i}`, space: 3, owner: '史昕銓', kind: 'coach',
        time: clock(start + i * (60 + buffer)), duration: 60, bufferMinutes: buffer,
      }));
      const frozen = bookings.map(b => Object.freeze(b));
      for (const input of [frozen, [...frozen].reverse()]) {
        const cards = readRenderedCards(renderDayViewFixture(input));
        assert.deepEqual(cards.map(c => c.id), bookings.map(b => b.id), `start=${start} buffer=${buffer}`);
        assert(cards.every(c => c.mainHeight === 120));
      }
    }
  }
});
