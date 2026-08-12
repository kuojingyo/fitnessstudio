import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAdminSegments, buildAdminSlotStates, wouldExceedAdminCapacity } from '../src/admin-schedule-layout.js';

test('行政時段允許第三位教練，但阻擋第四位教練', () => {
  const twoCoaches = [
    { id: 'coach-a', start: 0, end: 8 },
    { id: 'coach-b', start: 2, end: 8 },
  ];
  const threeCoaches = [
    ...twoCoaches,
    { id: 'coach-c', start: 4, end: 8 },
  ];

  assert.equal(wouldExceedAdminCapacity(twoCoaches, 4, 8), false);
  assert.equal(wouldExceedAdminCapacity(threeCoaches, 4, 8), true);
  assert.equal(wouldExceedAdminCapacity(threeCoaches, 4, 8, ['coach-c']), false);
  assert.equal(wouldExceedAdminCapacity(threeCoaches, 8, 10), false);
});

test('行政卡片依同時排班人數切換單欄、雙欄與三欄', () => {
  const bookings = [
    { id: 'coach-a', start: 0, end: 8 },
    { id: 'coach-b', start: 2, end: 8 },
    { id: 'coach-c', start: 4, end: 6 },
  ];

  const segments = buildAdminSegments(bookings);
  const shape = segments.map(({ id, start, end, count, index }) => ({ id, start, end, count, index }));

  assert.deepEqual(shape, [
    { id: 'coach-a', start: 0, end: 2, count: 1, index: 0 },
    { id: 'coach-a', start: 2, end: 4, count: 2, index: 0 },
    { id: 'coach-b', start: 2, end: 4, count: 2, index: 1 },
    { id: 'coach-a', start: 4, end: 6, count: 3, index: 0 },
    { id: 'coach-b', start: 4, end: 6, count: 3, index: 1 },
    { id: 'coach-c', start: 4, end: 6, count: 3, index: 2 },
    { id: 'coach-a', start: 6, end: 8, count: 2, index: 0 },
    { id: 'coach-b', start: 6, end: 8, count: 2, index: 1 },
  ]);
});

test('行政時段只有未滿三人時顯示新增入口', () => {
  const bookings = [
    { id: 'coach-a', start: 0, end: 4 },
    { id: 'coach-b', start: 1, end: 3 },
    { id: 'coach-c', start: 2, end: 3 },
  ];

  assert.deepEqual(buildAdminSlotStates(bookings, 5), [
    { slot: 0, count: 1, canAdd: true },
    { slot: 1, count: 2, canAdd: true },
    { slot: 2, count: 3, canAdd: false },
    { slot: 3, count: 1, canAdd: true },
    { slot: 4, count: 0, canAdd: true },
  ]);
});

test('同時開始的行政班維持資料順序，跨區段時不交換左右位置', () => {
  const bookings = [
    { id: 'coach-a', start: 0, end: 12 },
    { id: 'coach-b', start: 4, end: 12 },
    { id: 'coach-c', start: 4, end: 8 },
  ];

  const atThreeCoaches = buildAdminSegments(bookings)
    .filter(segment => segment.start === 4 && segment.end === 8)
    .map(segment => segment.id);

  assert.deepEqual(atThreeCoaches, ['coach-a', 'coach-b', 'coach-c']);
});
