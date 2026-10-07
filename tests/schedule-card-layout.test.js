import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDayViewFixture, readRenderedCards } from './fixtures/render-day-view.js';

for (const time of ['19:00', '20:05', '20:10']) {
  for (const bufferMinutes of [0, 5, 10, 15]) {
    test(`day renderer attaches ${bufferMinutes}-minute buffer to the course end at ${time}`, () => {
      const booking = { id: 'sample', space: 2, owner: 'Sample', kind: 'coach', time, duration: 60, bufferMinutes };
      const [card] = readRenderedCards(renderDayViewFixture([booking]));
      assert.equal(card.mainHeight, 120);
      assert.equal(card.rowspan, time === '19:00' ? 4 : 5, 'Buffer must not expand the occupied table rows');
      assert.equal(card.spacerHeight, Number(time.slice(-2)) * 2);
      if (bufferMinutes === 0) {
        assert.equal(card.tail, null);
      } else {
        assert.deepEqual(card.tail, { top: card.spacerHeight + card.mainHeight, height: bufferMinutes * 2 });
      }
    });
  }
}

for (const duration of [60, 75, 90]) {
  test(`day renderer preserves ${duration}-minute courses without buffers`, () => {
    const [card] = readRenderedCards(renderDayViewFixture([
      { id: 'sample', space: 2, owner: 'Sample', time: '20:05', duration },
    ]));
    assert.equal(card.mainHeight, duration * 2);
    assert.equal(card.spacerHeight, 10);
    assert.equal(card.rowspan, duration / 15 + 1);
    assert.equal(card.tail, null);
  });
}

test('day renderer keeps consecutive 19:00 and 20:05 cards and the displayed occupied end', () => {
  const cards = readRenderedCards(renderDayViewFixture([
    { id: 'first', space: 2, owner: 'Sample A', time: '19:00', duration: 60, bufferMinutes: 5 },
    { id: 'second', space: 2, owner: 'Sample B', time: '20:05', duration: 60, bufferMinutes: 5 },
  ]));
  assert.deepEqual(cards.map(card => card.id), ['first', 'second']);
  assert.deepEqual(cards.map(card => card.tail.top), [120, 130]);
  assert.match(cards[0].markup, /20:05<\/small>/);
  assert.match(cards[1].markup, /21:10<\/small>/);
});

test('off-grid buffer ends at the next grid-aligned consecutive card', () => {
  const cards = readRenderedCards(renderDayViewFixture([
    { id: 'first', space: 2, owner: 'Sample A', time: '20:05', duration: 60, bufferMinutes: 10 },
    { id: 'second', space: 2, owner: 'Sample B', time: '21:15', duration: 90, bufferMinutes: 0 },
  ]));
  assert.deepEqual(cards.map(card => card.id), ['first', 'second']);
  assert.deepEqual(cards[0].tail, { top: 130, height: 20 });
  assert.equal(cards[1].tail, null);
});

test('late off-grid course and buffer remain within the midnight grid', () => {
  const cases = [
    { time: '22:45', duration: 60, bufferMinutes: 15, lastRow: 55 },
    { time: '22:55', duration: 60, bufferMinutes: 5, lastRow: 55 },
    { time: '23:00', duration: 60, bufferMinutes: 0, lastRow: 56 },
  ];
  // These are isolated rendering fixtures, not new-booking validation inputs.
  for (const sample of cases) {
    const [card] = readRenderedCards(renderDayViewFixture([{ ...sample, id: 'late', space: 2, owner: 'Sample' }]));
    const endPx = card.tail ? card.tail.top + card.tail.height : card.spacerHeight + card.mainHeight;
    assert.equal(sample.lastRow * 30 + endPx, 1800, sample.time);
  }
});
