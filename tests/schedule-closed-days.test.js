import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeClosedDays, isClosedDay } from '../src/schedule-closed-days.js';

test('normalizeClosedDays 保留合法日期與設定者資訊', () => {
  const value = {
    '2026-09-15': { closedBy: '老闆', createdAt: 100 },
    '2026-09-16': true,
  };
  const normalized = normalizeClosedDays(value);
  assert.deepEqual(normalized['2026-09-15'], { closedBy: '老闆', createdAt: 100 });
  assert.ok(normalized['2026-09-16']);
});

test('normalizeClosedDays 忽略畸形鍵值與危險鍵', () => {
  const normalized = normalizeClosedDays({
    '2026-9-5': { closedBy: '老闆' },
    'bad-key': true,
    '__proto__': true,
    '2026-09-17': 'not-object-but-ok',
    '2026-09-18': { closedBy: 123, createdAt: 'x' },
  });
  assert.deepEqual(Object.keys(normalized), ['2026-09-17', '2026-09-18']);
  assert.equal(normalized['2026-09-17'], true);
  assert.deepEqual(normalized['2026-09-18'], true);
});

test('normalizeClosedDays 對 null 與非物件回傳空物件', () => {
  assert.deepEqual(normalizeClosedDays(null), {});
  assert.deepEqual(normalizeClosedDays('x'), {});
  assert.deepEqual(normalizeClosedDays([]), {});
});

test('isClosedDay 只對已設定的日期回傳 true', () => {
  const closedDays = normalizeClosedDays({ '2026-09-15': { closedBy: '老闆', createdAt: 1 } });
  assert.equal(isClosedDay(closedDays, '2026-09-15'), true);
  assert.equal(isClosedDay(closedDays, '2026-09-16'), false);
  assert.equal(isClosedDay(closedDays, ''), false);
  assert.equal(isClosedDay(null, '2026-09-15'), false);
});
