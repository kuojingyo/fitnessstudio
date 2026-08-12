import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyDateBookingMutation,
  commitDateBookingMutation,
} from '../src/schedule-booking-transaction.js';

const adminBooking = (id, time = '09:00', duration = 60) => ({
  id,
  date: '2026-08-13',
  space: 1,
  owner: id,
  kind: 'admin',
  time,
  duration,
});

const mutationFor = booking => ({
  removeIds: [],
  additions: [],
  replacements: [booking],
});

test('Firebase transaction 重試時會阻擋兩個客戶端同時建立第 3 人而形成 4 人', async () => {
  const initial = {
    a: adminBooking('a'),
    b: adminBooking('b'),
  };
  const third = adminBooking('c');
  const fourth = adminBooking('d');
  let serverValue = initial;

  const firstResult = await commitDateBookingMutation({
    reference: 'date-ref',
    mutation: mutationFor(third),
    runTransaction: async (_reference, updater, options) => {
      assert.deepEqual(options, { applyLocally: false });
      serverValue = updater(serverValue);
      return { committed: serverValue !== undefined };
    },
  });

  assert.equal(firstResult.committed, true);
  assert.equal(Object.keys(serverValue).length, 3);

  const secondResult = await commitDateBookingMutation({
    reference: 'date-ref',
    mutation: mutationFor(fourth),
    runTransaction: async (_reference, updater) => {
      const staleProposal = updater(initial);
      assert.equal(Object.keys(staleProposal).length, 3, '舊快照本來會誤判可寫入');

      const retriedProposal = updater(serverValue);
      if (retriedProposal !== undefined) serverValue = retriedProposal;
      return { committed: retriedProposal !== undefined };
    },
  });

  assert.deepEqual(secondResult, { committed: false, reason: 'admin-capacity' });
  assert.deepEqual(Object.keys(serverValue).sort(), ['a', 'b', 'c']);
});

test('修改行政排班時以同一 id 取代自己，不會把自己重複計入容量', () => {
  const current = {
    a: adminBooking('a'),
    b: adminBooking('b'),
    c: adminBooking('c'),
  };
  const replacement = adminBooking('c', '10:00', 60);

  const result = applyDateBookingMutation(current, {
    removeIds: ['c'],
    additions: [],
    replacements: [replacement],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.c.time, '10:00');
  assert.equal(Object.keys(result.value).length, 3);
});

test('transaction mutation 保留一般空間及未知欄位', () => {
  const current = {
    regular: {
      id: 'regular',
      date: '2026-08-13',
      space: 2,
      owner: '教練',
      kind: 'coach',
      time: '11:00',
      duration: 75,
      legacyField: 'keep-me',
    },
  };

  const result = applyDateBookingMutation(current, mutationFor(adminBooking('admin')));

  assert.equal(result.ok, true);
  assert.equal(result.value.regular.legacyField, 'keep-me');
  assert.equal(result.value.admin.space, 1);
});

test('刪除日期最後一筆排課時 transaction 寫入 null', () => {
  const result = applyDateBookingMutation(
    { only: adminBooking('only') },
    { removeIds: ['only'], additions: [], replacements: [] },
  );

  assert.deepEqual(result, { ok: true, value: null, reason: null });
});
