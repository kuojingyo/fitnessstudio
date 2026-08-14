import test from 'node:test';
import assert from 'node:assert/strict';
import * as bookingTransactionModule from '../src/schedule-booking-transaction.js';

import {
  applyDateBookingMutation,
  bookingMutationExpectedValues,
  buildDateBookingMutation,
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

const regularBooking = (id, space, owner, time, duration = 75, extra = {}) => ({
  id,
  date: '2026-08-13',
  space,
  owner,
  kind: 'coach',
  time,
  duration,
  ...extra,
});

const teamBookings = (groupId = 'team-group', spaces = [7, 8, 9], extra = {}) => spaces.map(space => ({
  id: `${groupId}-${space}`,
  date: '2026-08-13',
  space,
  owner: '史昕銓',
  kind: 'team',
  groupId,
  time: '18:00',
  duration: 75,
  ...extra,
}));

const mutationFor = booking => ({
  removeIds: [],
  additions: [booking],
  replacements: [],
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
    expectedRecords: [{ id: 'c', expected: bookingMutationExpectedValues(current.c) }],
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
  const only = adminBooking('only');
  const result = applyDateBookingMutation(
    { only },
    {
      removeIds: ['only'],
      additions: [],
      replacements: [],
      expectedRecords: [{ id: 'only', expected: bookingMutationExpectedValues(only) }],
    },
  );

  assert.deepEqual(result, { ok: true, value: null, reason: null });
});

test('拖曳行政時間只 patch 時間欄位並保留伺服器上的備註與未知欄位', () => {
  const current = {
    admin: {
      ...adminBooking('admin'),
      owner: '潘閱滔',
      remark: '另一台裝置更新的備註',
      legacyField: 'keep-me',
    },
  };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'admin',
      expected: { time: '09:00', duration: 60, space: 1, owner: '潘閱滔', kind: 'admin' },
      changes: { time: '09:15', duration: 75 },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.admin.time, '09:15');
  assert.equal(result.value.admin.duration, 75);
  assert.equal(result.value.admin.remark, '另一台裝置更新的備註');
  assert.equal(result.value.admin.legacyField, 'keep-me');
});

test('拖曳前的行政時間已被別台裝置修改時 transaction 中止', () => {
  const current = { admin: adminBooking('admin', '09:15', 60) };
  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'admin',
      expected: { time: '09:00', duration: 60, space: 1, owner: '老闆', kind: 'admin' },
      changes: { time: '09:00', duration: 90 },
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'booking-changed' });
});

test('舊版 admin 擁有者由畫面正規化為老闆後仍可拖曳行政時間', () => {
  const current = {
    legacy: { ...adminBooking('legacy'), owner: 'admin', remark: '保留舊資料' },
  };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'legacy',
      expected: { time: '09:00', duration: 60, space: 1, owner: '老闆', kind: 'admin' },
      changes: { time: '09:15', duration: 60 },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.legacy.time, '09:15');
  assert.equal(result.value.legacy.owner, 'admin');
  assert.equal(result.value.legacy.remark, '保留舊資料');
});

test('字串型 space 與 duration 且缺少 kind 的舊行政資料仍可拖曳', () => {
  const current = {
    legacy: {
      id: 'legacy', date: '2026-08-13', space: '1', owner: '史昕銓', time: '09:00', duration: '60', legacyField: 'keep-me',
    },
  };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'legacy',
      expected: { time: '09:00', duration: 60, space: 1, owner: '史昕銓', kind: 'admin' },
      changes: { time: '09:15', duration: 60 },
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.legacy.time, '09:15');
  assert.equal(result.value.legacy.space, '1');
  assert.equal('kind' in result.value.legacy, false);
  assert.equal(result.value.legacy.legacyField, 'keep-me');
});

test('舊版 admin 與老闆重疊時 transaction 視為同一位教練並中止', () => {
  const current = {
    target: { ...adminBooking('target'), owner: 'admin' },
    coach: {
      id: 'coach', date: '2026-08-13', space: 2, owner: '老闆', kind: 'coach', time: '10:00', duration: 75,
    },
  };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'target',
      expected: { time: '09:00', duration: 60, space: 1, owner: '老闆', kind: 'admin' },
      changes: { time: '09:00', duration: 90 },
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'owner-conflict' });
});

test('拖曳中的行政課程已被刪除時 transaction 中止', () => {
  const current = { other: adminBooking('other') };
  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'missing',
      expected: { time: '09:00', duration: 60, space: 1, owner: 'missing', kind: 'admin' },
      changes: { duration: 90 },
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'booking-missing' });
});

test('Firebase key 與 booking id 不一致時 resize 會因畸形日期節點中止', () => {
  const current = {
    target: { ...adminBooking('remote-id'), owner: '史昕銓' },
  };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'target',
      expected: { time: '09:00', duration: 60, space: 1, owner: '史昕銓', kind: 'admin' },
      changes: { time: '09:15', duration: 60 },
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'invalid-booking-data' });
});

test('拖曳延長行政時間後撞到同教練其他課程時 transaction 原子中止', () => {
  const target = { ...adminBooking('target', '09:00', 60), owner: '潘閱滔' };
  const coach = {
    id: 'coach', date: '2026-08-13', space: 2, owner: '潘閱滔', kind: 'coach', time: '10:00', duration: 75,
  };
  const current = { target, coach };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'target',
      expected: { time: '09:00', duration: 60, space: 1, owner: '潘閱滔', kind: 'admin' },
      changes: { time: '09:00', duration: 90 },
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'owner-conflict' });
});

test('Resize 先提交後，基於舊畫面的新增 transaction 仍會阻擋同教練重疊', () => {
  const current = {
    admin: { ...adminBooking('admin', '09:00', 90), owner: '潘閱滔' },
  };
  const staleAddition = {
    id: 'coach', date: '2026-08-13', space: 2, owner: '潘閱滔', kind: 'coach', time: '10:00', duration: 75,
  };

  const result = applyDateBookingMutation(current, {
    additions: [staleAddition],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'owner-conflict' });
});

test('同一 groupId 的團課三空間 transaction 不會被誤判為同教練重疊', () => {
  const groupId = 'team-group';
  const records = [7, 8, 9].map(space => ({
    id: `team-${space}`,
    date: '2026-08-13',
    space,
    owner: '史昕銓',
    kind: 'team',
    groupId,
    time: '18:00',
    duration: 75,
  }));

  const result = applyDateBookingMutation({}, { additions: records });

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['team-7', 'team-8', 'team-9']);
});

test('拖曳行政時間造成同時第 4 人時 transaction 原子中止', () => {
  const current = {
    target: adminBooking('target', '10:00', 60),
    a: adminBooking('a', '09:00', 60),
    b: adminBooking('b', '09:00', 60),
    c: adminBooking('c', '09:00', 60),
  };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'target',
      expected: { time: '10:00', duration: 60, space: 1, owner: 'target', kind: 'admin' },
      changes: { time: '09:30', duration: 60 },
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'admin-capacity' });
});

test('當日含未對齊時間的畸形歷史資料時 transaction fail-closed 中止', () => {
  const current = {
    target: adminBooking('target', '10:00', 60),
    a: adminBooking('a', '09:00', 60),
    b: adminBooking('b', '09:00', 60),
    malformed: adminBooking('malformed', '09:05', 60),
  };

  const result = applyDateBookingMutation(current, {
    patches: [{
      id: 'target',
      expected: { time: '10:00', duration: 60, space: 1, owner: 'target', kind: 'admin' },
      changes: { time: '09:30', duration: 60 },
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'invalid-booking-data' });
});

test('transaction 拒絕超出 09:00 至 22:00 或 30 至 240 分鐘的拖曳結果', () => {
  const current = { target: adminBooking('target', '09:00', 60) };
  const invalidChanges = [
    { time: '08:45', duration: 60 },
    { time: '09:00', duration: 15 },
    { time: '09:00', duration: 255 },
    { time: '21:45', duration: 30 },
    { time: '09:60', duration: 60 },
    { time: '09:00:extra', duration: 60 },
  ];

  invalidChanges.forEach(changes => {
    const result = applyDateBookingMutation(current, {
      patches: [{
        id: 'target',
        expected: { time: '09:00', duration: 60, space: 1, owner: 'target', kind: 'admin' },
        changes,
      }],
    });
    assert.deepEqual(result, { ok: false, value: current, reason: 'admin-range' });
  });
});

test('行政新增與修改 transaction 同樣拒絕小於 30 或大於 240 分鐘', () => {
  const original = adminBooking('too-long', '09:00', 60);
  const invalidMutations = [
    { current: {}, mutation: { additions: [adminBooking('too-short', '09:00', 15)] } },
    {
      current: { 'too-long': original },
      mutation: {
        removeIds: ['too-long'],
        replacements: [adminBooking('too-long', '09:00', 255)],
        expectedRecords: [{ id: 'too-long', expected: bookingMutationExpectedValues(original) }],
      },
    },
  ];

  invalidMutations.forEach(({ current, mutation }) => {
    const result = applyDateBookingMutation(current, mutation);
    assert.deepEqual(result, { ok: false, value: current, reason: 'admin-range' });
  });
});

test('Firebase key 與內嵌 id 不一致時任何 mutation 都 fail-closed', () => {
  const current = {
    remoteKey: { ...adminBooking('different-id'), owner: '史昕銓' },
  };

  const writeResult = applyDateBookingMutation(current, {
    additions: [{ ...adminBooking('new-booking', '11:00'), owner: '潘閱滔' }],
  });
  assert.deepEqual(writeResult, { ok: false, value: current, reason: 'invalid-booking-data' });

  const deleteResult = applyDateBookingMutation(current, {
    removeIds: ['remoteKey'],
  });
  assert.deepEqual(deleteResult, { ok: false, value: current, reason: 'invalid-booking-data' });
});

test('一般修改的原紀錄已被遠端刪除時 transaction 不得復活舊資料', () => {
  const original = {
    id: 'coach', date: '2026-08-13', space: 2, owner: '史昕銓', kind: 'coach', time: '11:00', duration: 75,
  };
  const replacement = { ...original, time: '11:15' };

  const result = applyDateBookingMutation({}, {
    removeIds: ['coach'],
    replacements: [replacement],
    expectedRecords: [{ id: 'coach', expected: original }],
  });

  assert.deepEqual(result, { ok: false, value: {}, reason: 'booking-missing' });
});

test('一般修改保留遠端未知欄位，但遠端已改使用者欄位時中止', () => {
  const original = {
    id: 'coach', date: '2026-08-13', space: 2, owner: '史昕銓', kind: 'coach', time: '11:00', duration: 75, remark: '原備註',
  };
  const replacement = { ...original, time: '11:15', remark: '新備註' };
  const mutation = {
    removeIds: ['coach'],
    replacements: [replacement],
    expectedRecords: [{ id: 'coach', expected: original }],
  };

  const unknownFieldResult = applyDateBookingMutation({
    coach: { ...original, serverOnlyField: 'keep-me' },
  }, mutation);
  assert.equal(unknownFieldResult.ok, true);
  assert.equal(unknownFieldResult.value.coach.time, '11:15');
  assert.equal(unknownFieldResult.value.coach.remark, '新備註');
  assert.equal(unknownFieldResult.value.coach.serverOnlyField, 'keep-me');

  const changedResult = applyDateBookingMutation({
    coach: { ...original, remark: '另一台已修改' },
  }, mutation);
  assert.deepEqual(changedResult, {
    ok: false,
    value: { coach: { ...original, remark: '另一台已修改' } },
    reason: 'booking-changed',
  });
});

test('一般修改 CAS 快照忽略日期節點推導值與未知欄位', () => {
  const snapshot = bookingMutationExpectedValues({
    id: 'coach',
    date: '2026-08-13',
    space: 2,
    owner: '史昕銓',
    kind: 'coach',
    time: '11:00',
    duration: 75,
    remark: '原備註',
    createdAt: 123,
    serverOnlyField: '不應進入 CAS',
  });

  assert.deepEqual(snapshot, {
    space: 2,
    owner: '史昕銓',
    kind: 'coach',
    time: '11:00',
    duration: 75,
    nickname: undefined,
    remark: '原備註',
    groupId: undefined,
    createdAt: 123,
  });
});

test('刪除前紀錄已被其他裝置修改時 transaction 中止', () => {
  const original = {
    id: 'coach', date: '2026-08-13', space: 2, owner: '史昕銓', kind: 'coach', time: '11:00', duration: 75, remark: '原備註',
  };
  const current = {
    coach: { ...original, remark: '另一台已修改' },
  };

  const result = applyDateBookingMutation(current, {
    removeIds: ['coach'],
    expectedRecords: [{ id: 'coach', expected: bookingMutationExpectedValues(original) }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'booking-changed' });
});

test('一般修改清除已移除的選填欄位，同時保留未知伺服器欄位', () => {
  const original = {
    id: 'coach', date: '2026-08-13', space: 7, owner: '其他', kind: 'coach', time: '18:00', duration: 75,
    nickname: '原暱稱', remark: '原備註', groupId: 'old-group', createdAt: 123, serverOnlyField: 'keep-me',
  };
  const replacement = {
    id: 'coach', date: '2026-08-13', space: 7, owner: '史昕銓', kind: 'coach', time: '18:00', duration: 75, createdAt: 456,
  };

  const result = applyDateBookingMutation({ coach: original }, {
    removeIds: ['coach'],
    replacements: [replacement],
    expectedRecords: [{ id: 'coach', expected: bookingMutationExpectedValues(original) }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.coach.serverOnlyField, 'keep-me');
  assert.equal(result.value.coach.createdAt, 456);
  assert.equal('nickname' in result.value.coach, false);
  assert.equal('remark' in result.value.coach, false);
  assert.equal('groupId' in result.value.coach, false);
});

test('非物件日期節點會中止 transaction，避免覆寫既有資料', () => {
  const current = 'legacy-scalar';

  const result = applyDateBookingMutation(current, {
    additions: [adminBooking('new-booking')],
  });

  assert.deepEqual(result, {
    ok: false,
    value: current,
    reason: 'invalid-booking-data',
  });
});

test('日期節點含危險 child key 時會中止，不允許 prototype pollution', () => {
  const current = JSON.parse(`{
    "__proto__": {
      "id": "__proto__",
      "date": "2026-08-13",
      "space": 2,
      "owner": "史昕銓",
      "kind": "coach",
      "time": "10:00",
      "duration": 75
    }
  }`);

  const result = applyDateBookingMutation(current, {
    additions: [adminBooking('new-booking')],
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-booking-data');
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
  assert.equal(Object.hasOwn(result.value, '__proto__'), true);
});

test('舊陣列日期節點可依內嵌 id 修改並遷移為安全物件', () => {
  const original = {
    id: 'legacy', date: '2026-08-13', space: 2, owner: '史昕銓', kind: 'coach', time: '10:00', duration: 75,
  };

  const result = applyDateBookingMutation([original], {
    removeIds: ['legacy'],
    replacements: [{ ...original, time: '10:15' }],
    expectedRecords: [{ id: 'legacy', expected: bookingMutationExpectedValues(original) }],
  });

  assert.equal(result.ok, true);
  assert.equal(Array.isArray(result.value), false);
  assert.deepEqual(Object.keys(result.value), ['legacy']);
  assert.equal(result.value.legacy.time, '10:15');
});

test('新增排課 id 已存在時 transaction 中止，不能覆蓋遠端紀錄', () => {
  const remote = {
    id: 'collision', date: '2026-08-13', space: 2, owner: '史昕銓', kind: 'coach', time: '10:00', duration: 75,
    remark: '遠端更新', serverOnlyField: 'keep-me',
  };
  const current = { collision: remote };

  const result = applyDateBookingMutation(current, {
    additions: [{ ...remote, owner: '潘閱滔', remark: '舊畫面資料' }],
  });

  assert.deepEqual(result, {
    ok: false,
    value: current,
    reason: 'booking-exists',
  });
});

test('replacement 沒有 expectedRecords 前置條件時一律中止', () => {
  const remote = {
    id: 'collision', date: '2026-08-13', space: 2, owner: '史昕銓', kind: 'coach', time: '10:00', duration: 75,
    remark: '遠端更新',
  };
  const current = { collision: remote };

  const overwrite = applyDateBookingMutation(current, {
    replacements: [{ ...remote, remark: '舊畫面資料' }],
  });
  const upsert = applyDateBookingMutation({}, {
    replacements: [remote],
  });

  assert.deepEqual(overwrite, { ok: false, value: current, reason: 'invalid-mutation' });
  assert.deepEqual(upsert, { ok: false, value: {}, reason: 'invalid-mutation' });
});

test('刪除沒有 expectedRecords 前置條件時一律中止', () => {
  const remote = {
    id: 'delete-me', date: '2026-08-13', space: 2, owner: '史昕銓', kind: 'coach', time: '10:00', duration: 75,
  };
  const current = { 'delete-me': remote };

  const result = applyDateBookingMutation(current, {
    removeIds: ['delete-me'],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'invalid-mutation' });
});

test('patch 缺少完整 expected CAS 欄位時一律中止', () => {
  const current = {
    target: adminBooking('target', '09:00', 60, '史昕銓'),
  };

  for (const expected of [undefined, {}, { time: '09:00' }]) {
    const result = applyDateBookingMutation(current, {
      patches: [{
        id: 'target',
        expected,
        changes: { time: '09:15', duration: 60 },
      }],
    });
    assert.deepEqual(result, { ok: false, value: current, reason: 'invalid-mutation' });
  }
});

test('不同教練同時搶同一一般場地時 transaction 原子中止', () => {
  const current = {
    first: regularBooking('first', 2, '史昕銓', '10:00', 75),
  };
  const candidate = regularBooking('second', 2, '高芷妍', '10:30', 75);

  const result = applyDateBookingMutation(current, {
    additions: [candidate],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'space-conflict' });
});

test('其他教練也不得與既有排課重疊同一一般場地', () => {
  const current = {
    existing: regularBooking('existing', 2, '其他', '10:00'),
  };
  const incoming = regularBooking('incoming', 2, '其他', '10:30');
  incoming.nickname = '另一位場租教練';

  const result = applyDateBookingMutation(current, {
    additions: [incoming],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'space-conflict' });
});

test('同一一般場地首尾相接採半開區間，不算重疊', () => {
  const current = {
    first: regularBooking('first', 2, '史昕銓', '10:00', 75),
  };
  const candidate = regularBooking('second', 2, '高芷妍', '11:15', 75);

  const result = applyDateBookingMutation(current, {
    additions: [candidate],
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.second.time, '11:15');
});

test('團課缺少 7、8、9 任一成員時 transaction 整筆中止', () => {
  const records = teamBookings('incomplete-team', [7, 8]);

  const result = applyDateBookingMutation({}, {
    additions: records,
  });

  assert.deepEqual(result, { ok: false, value: {}, reason: 'invalid-group' });
});

test('團課表單開啟後遠端新增同 groupId 成員時 exact membership CAS 中止', () => {
  const groupId = 'changed-team';
  const original = teamBookings(groupId);
  const extra = {
    ...original[0],
    id: `${groupId}-extra`,
    space: 10,
  };
  const current = Object.fromEntries([...original, extra].map(booking => [booking.id, booking]));

  const result = applyDateBookingMutation(current, {
    removeIds: original.map(booking => booking.id),
    expectedRecords: original.map(booking => ({
      id: booking.id,
      expected: bookingMutationExpectedValues(booking),
    })),
    expectedGroups: [{
      groupId,
      memberIds: original.map(booking => booking.id),
      requiredSpaces: [7, 8, 9],
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'group-changed' });
});

test('遠端團課共享欄位不一致時即使整組刪除也 fail-closed', () => {
  const groupId = 'malformed-team';
  const records = teamBookings(groupId);
  records[2] = { ...records[2], time: '18:15' };
  const current = Object.fromEntries(records.map(booking => [booking.id, booking]));

  const result = applyDateBookingMutation(current, {
    removeIds: records.map(booking => booking.id),
    expectedRecords: records.map(booking => ({
      id: booking.id,
      expected: bookingMutationExpectedValues(booking),
    })),
    expectedGroups: [{
      groupId,
      memberIds: records.map(booking => booking.id),
      requiredSpaces: [7, 8, 9],
    }],
  });

  assert.deepEqual(result, { ok: false, value: current, reason: 'invalid-group' });
});

test('建立排課 mutation 只使用 additions，不得誤走 replacement upsert', () => {
  const record = regularBooking('new-booking', 2, '史昕銓', '10:00');

  const mutation = buildDateBookingMutation({
    mode: 'create',
    records: [record],
  });

  assert.deepEqual(mutation, {
    removeIds: [],
    additions: [record],
    replacements: [],
    expectedRecords: [],
    expectedGroups: [],
  });
});

test('修改團課 mutation 使用 replacements 並攜帶逐筆及 exact membership CAS', () => {
  const originalRecords = teamBookings('edit-team');
  const records = originalRecords.map(booking => ({ ...booking, time: '19:00' }));

  const mutation = buildDateBookingMutation({
    mode: 'edit',
    originalRecords,
    records,
    requiredTeamSpaces: [7, 8, 9],
  });

  assert.deepEqual(mutation, {
    removeIds: [],
    additions: [],
    replacements: records,
    expectedRecords: originalRecords.map(booking => ({
      id: booking.id,
      expected: bookingMutationExpectedValues(booking),
    })),
    expectedGroups: [{
      groupId: 'edit-team',
      memberIds: originalRecords.map(booking => booking.id),
      requiredSpaces: [7, 8, 9],
    }],
  });
});

test('刪除團課 mutation 會刪除完整群組並攜帶 exact membership CAS', () => {
  const originalRecords = teamBookings('delete-team');

  const mutation = buildDateBookingMutation({
    mode: 'delete',
    originalRecords,
    requiredTeamSpaces: [7, 8, 9],
  });

  assert.deepEqual(mutation, {
    removeIds: originalRecords.map(booking => booking.id),
    additions: [],
    replacements: [],
    expectedRecords: originalRecords.map(booking => ({
      id: booking.id,
      expected: bookingMutationExpectedValues(booking),
    })),
    expectedGroups: [{
      groupId: 'delete-team',
      memberIds: originalRecords.map(booking => booking.id),
      requiredSpaces: [7, 8, 9],
    }],
  });
});

test('一般課改團課時舊 id 走 replacement，新增空間走 additions', () => {
  const original = regularBooking('regular-to-team', 7, '史昕銓', '18:00');
  const records = [
    { ...original, kind: 'team', groupId: 'new-team' },
    { ...original, id: 'new-space-8', space: 8, kind: 'team', groupId: 'new-team' },
    { ...original, id: 'new-space-9', space: 9, kind: 'team', groupId: 'new-team' },
  ];

  const mutation = buildDateBookingMutation({ mode: 'edit', originalRecords: [original], records });
  const result = applyDateBookingMutation({ [original.id]: original }, mutation);

  assert.deepEqual(mutation.removeIds, []);
  assert.deepEqual(mutation.replacements.map(booking => booking.id), ['regular-to-team']);
  assert.deepEqual(mutation.additions.map(booking => booking.id), ['new-space-8', 'new-space-9']);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.values(result.value).map(booking => Number(booking.space)).sort(), [7, 8, 9]);
});

test('團課改一般課時保留目前空間舊 id 並原子刪除其餘成員', () => {
  const originalRecords = teamBookings('team-to-regular');
  const kept = { ...originalRecords[0], kind: 'coach' };
  delete kept.groupId;

  const mutation = buildDateBookingMutation({ mode: 'edit', originalRecords, records: [kept] });
  const current = Object.fromEntries(originalRecords.map(booking => [booking.id, booking]));
  const result = applyDateBookingMutation(current, mutation);

  assert.deepEqual(mutation.removeIds, originalRecords.slice(1).map(booking => booking.id));
  assert.deepEqual(mutation.replacements.map(booking => booking.id), [kept.id]);
  assert.deepEqual(mutation.additions, []);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value), [kept.id]);
  assert.equal(result.value[kept.id].kind, 'coach');
  assert.equal(Object.hasOwn(result.value[kept.id], 'groupId'), false);
});

test('跨日期貼上行政時段會建立新 id 並只複製可排課欄位', () => {
  const source = {
    id: 'source-admin',
    date: '2026-08-14',
    space: 1,
    owner: '其他',
    nickname: '代班教練',
    kind: 'admin',
    time: '09:30',
    duration: 120,
    remark: '開店行政',
    createdAt: 100,
    groupId: 'must-not-copy',
    serverOnly: 'must-not-copy',
  };

  const result = bookingTransactionModule.buildAdminBookingPaste({
    source,
    targetDate: '2026-08-15',
    id: 'new-admin',
    createdAt: 200,
  });

  const booking = {
    id: 'new-admin',
    date: '2026-08-15',
    space: 1,
    owner: '其他',
    nickname: '代班教練',
    kind: 'admin',
    time: '09:30',
    duration: 120,
    remark: '開店行政',
    createdAt: 200,
  };
  assert.deepEqual(result, {
    booking,
    mutation: buildDateBookingMutation({ mode: 'create', records: [booking] }),
  });
});

test('行政時段不可貼回來源日期', () => {
  const source = adminBooking('source-admin');

  const result = bookingTransactionModule.buildAdminBookingPaste({
    source,
    targetDate: source.date,
    id: 'new-admin',
    createdAt: 200,
  });

  assert.equal(result, null);
});

test('一般教練課不可透過行政右鍵功能貼上', () => {
  const source = regularBooking('source-coach', 2, '史昕銓', '09:00');

  const result = bookingTransactionModule.buildAdminBookingPaste({
    source,
    targetDate: '2026-08-15',
    id: 'new-admin',
    createdAt: 200,
  });

  assert.equal(result, null);
});

test('行政貼上缺少新 id 時不得建立字面值 null 的排課', () => {
  const result = bookingTransactionModule.buildAdminBookingPaste({
    source: adminBooking('source-admin'),
    targetDate: '2026-08-15',
    id: null,
    createdAt: 200,
  });

  assert.equal(result, null);
});

test('行政貼上缺少目標日期時不得建立字面值 null 的日期', () => {
  const result = bookingTransactionModule.buildAdminBookingPaste({
    source: adminBooking('source-admin'),
    targetDate: null,
    id: 'new-admin',
    createdAt: 200,
  });

  assert.equal(result, null);
});

test('行政貼上不得複製缺少教練名稱的異常來源資料', () => {
  const result = bookingTransactionModule.buildAdminBookingPaste({
    source: adminBooking(undefined),
    targetDate: '2026-08-15',
    id: 'new-admin',
    createdAt: 200,
  });

  assert.equal(result, null);
});

test('教練衝突訊息使用新增、貼上與調整都適用的通用文字', () => {
  const message = bookingTransactionModule.bookingMutationErrorMessage?.('owner-conflict');

  assert.equal(message, '⚠️ 此操作會與同一位教練的其他排課重疊。');
});
