import test from 'node:test';
import assert from 'node:assert/strict';
import { hourChoices, minuteChoices, splitClock, composeClock } from '../src/schedule-booking-rules.js';

test('hourChoices：9 到 21 共 13 個選項', () => {
  const list = hourChoices();
  assert.equal(list.length, 13);
  assert.equal(list[0], 9);
  assert.equal(list[list.length - 1], 21);
  assert.deepEqual(list, [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
});

test('minuteChoices：預設 5 分鐘格，12 項（00、05 … 55）', () => {
  const list = minuteChoices();
  assert.equal(list.length, 12);
  assert.equal(list[0], '00');
  assert.equal(list[1], '05');
  assert.equal(list[list.length - 1], '55');
});

test('minuteChoices：15 分鐘格，4 項', () => {
  assert.deepEqual(minuteChoices({ fifteenStep: true }), ['00', '15', '30', '45']);
});

test('splitClock：合法時間拆成 {hour, minute}', () => {
  assert.deepEqual(splitClock('11:05'), { hour: 11, minute: 5 });
  assert.deepEqual(splitClock('09:00'), { hour: 9, minute: 0 });
  assert.deepEqual(splitClock('21:55'), { hour: 21, minute: 55 });
});

test('splitClock：非法值回傳 null', () => {
  assert.equal(splitClock('bad'), null);
  assert.equal(splitClock(''), null);
  assert.equal(splitClock(null), null);
  assert.equal(splitClock('25:00'), null);
  assert.equal(splitClock('11:60'), null);
  assert.equal(splitClock('1:05'), null);
});

test('composeClock：組回 HH:MM', () => {
  assert.equal(composeClock(11, 5), '11:05');
  assert.equal(composeClock(9, 0), '09:00');
  assert.equal(composeClock(21, 55), '21:55');
});

test('composeClock：非法值回傳 null', () => {
  assert.equal(composeClock(NaN, 5), null);
  assert.equal(composeClock(11, 99), null);
  assert.equal(composeClock(11, -5), null);
  assert.equal(composeClock(24, 0), null);
});
