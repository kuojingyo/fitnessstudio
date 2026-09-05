import test from 'node:test';
import assert from 'node:assert/strict';

test('日檢視索引在每個場地時段保留舊查詢的第一筆結果，不修改原資料', async () => {
  const { buildDayBookingIndex } = await import('../src/schedule-day-index.js');
  const bookings = Array.from({ length: 240 }, (_, i) => Object.freeze({
    id: String(i), space: String(i % 9 + 1),
    time: `${String(9 + Math.floor((i * 7 % 52) / 4)).padStart(2, '0')}:${String((i * 7 % 4) * 15).padStart(2, '0')}`,
    duration: [30, 60, 75, 90][i % 4],
  }));
  Object.freeze(bookings);
  const toSlot = value => { const [h, m] = value.split(':').map(Number); return (h * 60 + m - 540) / 15; };
  const index = buildDayBookingIndex(bookings, 52);
  for (let space = 1; space <= 9; space++) {
    for (let slot = 0; slot < 52; slot++) {
      const expected = bookings.find(b => Number(b.space) === space && toSlot(b.time) <= slot && slot < toSlot(b.time) + Number(b.duration) / 15);
      assert.equal(index.get(space)?.[slot], expected, `space=${space}, slot=${slot}`);
    }
  }
  assert.equal(buildDayBookingIndex([], 52).size, 0);
});
