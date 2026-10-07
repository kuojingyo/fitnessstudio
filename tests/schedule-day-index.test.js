import test from 'node:test';
import assert from 'node:assert/strict';

test('日檢視索引在每個場地時段保留第一筆結果，不修改原資料（15 分鐘對齊資料）', async () => {
  const { buildDayBookingIndex } = await import('../src/schedule-day-index.js');
  const bookings = Array.from({ length: 240 }, (_, i) => Object.freeze({
    id: String(i), space: String(i % 9 + 1),
    time: `${String(9 + Math.floor((i * 7 % 52) / 4)).padStart(2, '0')}:${String((i * 7 % 4) * 15).padStart(2, '0')}`,
    duration: [30, 60, 75, 90][i % 4],
  }));
  Object.freeze(bookings);
  const toMinute = value => { const [h, m] = value.split(':').map(Number); return h * 60 + m - 540; };
  const index = buildDayBookingIndex(bookings, 52);
  for (let space = 1; space <= 9; space++) {
    for (let slot = 0; slot < 52; slot++) {
      const expected = bookings.find(b => {
        if (Number(b.space) !== space) return false;
        const start = toMinute(b.time);
        const end = start + Number(b.duration);
        return Math.floor(start / 15) <= slot && slot < Math.ceil(end / 15);
      });
      assert.equal(index.get(space)?.[slot], expected, `space=${space}, slot=${slot}`);
    }
  }
  assert.equal(buildDayBookingIndex([], 52).size, 0);
});

test('5 分鐘起點佔用起點格；課後緩衝不佔格（緩衝由卡片尾巴呈現）', async () => {
  const { buildDayBookingIndex } = await import('../src/schedule-day-index.js');
  const bookings = [
    { id: 'a', space: 2, time: '11:05', duration: 60, bufferMinutes: 5 },
    { id: 'b', space: 3, time: '10:00', duration: 60, bufferMinutes: 15 },
    { id: 'c', space: 4, time: '21:45', duration: 90 },
  ];
  const index = buildDayBookingIndex(bookings, 52);

  const space2 = index.get(2);
  assert.equal(space2[7], undefined, '11:00 格之前未被佔用');
  for (let slot = 8; slot <= 12; slot++) assert.equal(space2[slot]?.id, 'a', `slot=${slot} 應由 11:05 的課覆蓋`);
  assert.equal(space2[13], undefined);

  const space3 = index.get(3);
  for (let slot = 4; slot <= 7; slot++) assert.equal(space3[slot]?.id, 'b', `slot=${slot} 屬 10:00 的課主體`);
  assert.equal(space3[8], undefined, '緩衝尾巴不佔 11:00 格，下一堂課可從 11:00／11:05 起排');

  const space4 = index.get(4);
  assert.equal(space4[51]?.id, 'c');
  assert.equal(space4[50], undefined, '21:30 格未被佔用');
});

test('連堂資料：前堂緩衝不搶走下一堂的起點格', async () => {
  const { buildDayBookingIndex } = await import('../src/schedule-day-index.js');
  const first = { id: 'first', space: 3, time: '10:00', duration: 60, bufferMinutes: 5 };
  const second = { id: 'second', space: 3, time: '11:05', duration: 60, bufferMinutes: 5 };
  const index = buildDayBookingIndex([first, second], 52);
  assert.equal(index.get(3)[4]?.id, 'first', '10:00 起點格屬前堂課');
  assert.equal(index.get(3)[7]?.id, 'first', '10:45 格仍屬前堂課主體');
  assert.equal(index.get(3)[8]?.id, 'second', '11:00 格是 11:05 新課的起點格（連堂可見）');
  assert.equal(index.get(3)[12]?.id, 'second', '12:00 格屬新課主體');
});

test('格線延伸到午夜（60 格）時，21:45 的 90 分鐘課完整佔用 22:00 後的格', async () => {
  const { buildDayBookingIndex } = await import('../src/schedule-day-index.js');
  const index = buildDayBookingIndex([
    { id: 'late', space: 4, time: '21:45', duration: 90 },
  ], 60);
  const space4 = index.get(4);
  for (let slot = 51; slot <= 56; slot++) assert.equal(space4[slot]?.id, 'late', `slot=${slot} 應由 21:45 的課覆蓋`);
  assert.equal(space4[57], undefined, '23:15 後的格未被佔用');
  assert.equal(space4[50], undefined, '21:30 格未被佔用');
});

test('重疊資料時保留先出現的排課（與渲染第一筆一致）', async () => {
  const { buildDayBookingIndex } = await import('../src/schedule-day-index.js');
  const first = { id: 'first', space: 5, time: '10:00', duration: 60 };
  const second = { id: 'second', space: 5, time: '10:15', duration: 60 };
  const index = buildDayBookingIndex([first, second], 52);
  assert.equal(index.get(5)[4]?.id, 'first');
  assert.equal(index.get(5)[7]?.id, 'first', '重疊格保留先出現者');
  assert.equal(index.get(5)[8]?.id, 'second', '只被第二筆覆蓋的格仍屬第二筆');
});
