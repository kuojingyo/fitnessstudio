import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveDropSlot,
  resolveDropSpace,
} from '../src/schedule-booking-rules.js';

import {
  buildBookingMovePlan,
  buildBookingMovePlanFromRecords,
  commitBookingMove,
  copyBookingRecordsForDate,
  relocateBookingRecords,
} from '../src/schedule-booking-transaction.js';

const coach = (over = {}) => ({
  id: 'coach-1', date: '2026-09-22', space: 3, owner: '史昕銓', kind: 'coach',
  time: '10:00', duration: 75, createdAt: 1, ...over,
});
const team = (space, over = {}) => ({
  id: `team-${space}`, date: '2026-09-22', space, owner: '高芷妍', kind: 'team',
  time: '19:00', duration: 90, groupId: 'team_g1', createdAt: 1, ...over,
});

function fakeRunTransaction(db) {
  return async (reference, updater) => {
    const next = updater(db[reference] ?? null);
    if (next === undefined) return { committed: false };
    // 真實 Firebase 在節點清空時會把該日期節點整個移除；測試保留空物件以便斷言
    db[reference] = next ?? {};
    return { committed: true };
  };
}

test('同日搬移：教練課改時間與場地，id／日期／時長不變', () => {
  const records = relocateBookingRecords([coach()], { time: '14:00', space: 5 });
  assert.equal(records.length, 1);
  assert.equal(records[0].id, 'coach-1');
  assert.equal(records[0].date, '2026-09-22');
  assert.equal(records[0].time, '14:00');
  assert.equal(records[0].space, 5);
  assert.equal(records[0].duration, 75);
});

test('同日搬移：團課三筆一起改時間，場地固定 7／8／9', () => {
  const records = relocateBookingRecords([team(7), team(8), team(9)], { time: '20:00', space: 7 });
  assert.deepEqual(records.map(item => item.space), [7, 8, 9]);
  assert.ok(records.every(item => item.time === '20:00'));
  assert.ok(records.every(item => item.groupId === 'team_g1'));
});

test('同日搬移：行政排班搬時間，場地維持行政時段(1)', () => {
  const admin = { id: 'admin-1', date: '2026-09-22', space: 1, owner: '洪琇捷', kind: 'admin', time: '09:00', duration: 120, createdAt: 1 };
  const records = relocateBookingRecords([admin], { time: '13:00', space: 1 });
  assert.equal(records[0].space, 1);
  assert.equal(records[0].time, '13:00');
});

test('跨日搬移：使用新 id、帶到目標日期，保留擁有者／備註／新增者／草稿', () => {
  let n = 0;
  const moved = copyBookingRecordsForDate([coach({ remark: '體驗課', createdBy: '高芷妍', draft: true })], {
    date: '2026-09-23', space: 6, makeId: () => `new-${++n}`,
  });
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, 'new-1');
  assert.equal(moved[0].date, '2026-09-23');
  assert.equal(moved[0].space, 6);
  assert.equal(moved[0].time, '10:00');
  assert.equal(moved[0].duration, 75);
  assert.equal(moved[0].remark, '體驗課');
  assert.equal(moved[0].createdBy, '高芷妍');
  assert.equal(moved[0].draft, true);
});

test('跨日搬移：團課三筆一起帶過去，場地仍為 7／8／9', () => {
  let n = 0;
  const moved = copyBookingRecordsForDate([team(7), team(8), team(9)], {
    date: '2026-09-24', space: 7, makeId: () => `new-${++n}`,
  });
  assert.deepEqual(moved.map(item => item.space), [7, 8, 9]);
  assert.ok(moved.every(item => item.date === '2026-09-24'));
  assert.ok(moved.every(item => item.groupId === 'team_g1'));
  assert.deepEqual(moved.map(item => item.id), ['new-1', 'new-2', 'new-3']);
});

test('跨日搬移計畫：目標新增＋來源刪除（含版本檢查）＋補償刪除', () => {
  let n = 0;
  const plan = buildBookingMovePlan({
    originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 4, makeId: () => `new-${++n}`,
  });
  assert.ok(plan);
  assert.equal(plan.records.length, 1);
  assert.equal(plan.targetMutation.additions.length, 1);
  assert.equal(plan.targetMutation.removeIds.length, 0);
  assert.deepEqual(plan.sourceMutation.removeIds, ['coach-1']);
  assert.equal(plan.sourceMutation.expectedRecords.length, 1, '來源刪除必須帶版本檢查');
  assert.deepEqual(plan.rollbackMutation.removeIds, ['new-1']);
});

test('編輯視窗改日期：由使用者編輯後的記錄組出搬移計畫', () => {
  const edited = coach({ id: 'new-1', date: '2026-09-26', space: 5, time: '15:00', duration: 90, remark: '改過' });
  const plan = buildBookingMovePlanFromRecords({ records: [edited], originalRecords: [coach()] });
  assert.ok(plan);
  assert.equal(plan.targetMutation.additions.length, 1);
  assert.equal(plan.targetMutation.additions[0].time, '15:00');
  assert.equal(plan.targetMutation.additions[0].duration, 90);
  assert.deepEqual(plan.sourceMutation.removeIds, ['coach-1']);
  assert.deepEqual(plan.rollbackMutation.removeIds, ['new-1']);
  assert.equal(buildBookingMovePlanFromRecords({ records: [edited], originalRecords: [coach({ date: '2026-09-26' })] }), null, '同一天不需要跨日搬移');
  assert.equal(buildBookingMovePlanFromRecords({ records: [], originalRecords: [coach()] }), null);
});

test('跨日搬移計畫：無效輸入回傳 null', () => {
  assert.equal(buildBookingMovePlan({ originalRecords: [], targetDate: '2026-09-23', targetSpace: 4, makeId: () => 'x' }), null);
  assert.equal(buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-22', targetSpace: 4, makeId: () => 'x' }), null, '同一天不需跨日搬移');
  assert.equal(buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026/09/23', targetSpace: 4, makeId: () => 'x' }), null);
  assert.equal(buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 0, makeId: () => 'x' }), null);
  assert.equal(
    buildBookingMovePlan({ originalRecords: [team(7), team(8), team(9)], targetDate: '2026-09-23', targetSpace: 3, makeId: () => 'x' }),
    null, '團課只能搬在 7／8／9',
  );
});

test('跨日搬移：目標日有衝突時不寫入，來源完全不動', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 4, makeId: () => `new-${++n}` });
  const db = {
    '2026-09-23': { other: coach({ id: 'other', space: 4, time: '10:15' }) },
    '2026-09-22': { 'coach-1': coach() },
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-23', sourceReference: '2026-09-22', plan, runTransaction: fakeRunTransaction(db),
  });
  assert.equal(result.committed, false);
  assert.equal(result.reason, 'space-conflict');
  assert.equal(db['2026-09-22']['coach-1'].time, '10:00', '來源不得被更動');
  assert.equal(db['2026-09-23'].other.time, '10:15');
  assert.equal(db['2026-09-23']['new-1'], undefined, '目標不得留下資料');
});

test('跨日搬移：來源已被他人修改時，回滾目標並回報失敗', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 4, makeId: () => `new-${++n}` });
  const db = {
    '2026-09-23': {},
    '2026-09-22': { 'coach-1': coach({ time: '11:00' }) },
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-23', sourceReference: '2026-09-22', plan, runTransaction: fakeRunTransaction(db),
  });
  assert.equal(result.committed, false);
  assert.equal(result.reason, 'booking-changed');
  assert.equal(result.rolledBack, true, '必須補償刪除目標日新資料');
  assert.equal(db['2026-09-23']['new-1'], undefined);
  assert.equal(db['2026-09-22']['coach-1'].time, '11:00');
});

test('跨日搬移：正常情況兩邊都寫入', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 4, makeId: () => `new-${++n}` });
  const db = {
    '2026-09-23': {},
    '2026-09-22': { 'coach-1': coach() },
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-23', sourceReference: '2026-09-22', plan, runTransaction: fakeRunTransaction(db),
  });
  assert.equal(result.committed, true);
  assert.equal(result.reason, null);
  assert.equal(db['2026-09-22']['coach-1'], undefined, '來源已刪除');
  assert.equal(db['2026-09-23']['new-1'].time, '10:00');
  assert.equal(db['2026-09-23']['new-1'].space, 4);
});

test('跨日搬移：團課整組搬到別的日期', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({
    originalRecords: [team(7), team(8), team(9)], targetDate: '2026-09-25', targetSpace: 7, makeId: () => `new-${++n}`,
  });
  const db = {
    '2026-09-25': {},
    '2026-09-22': { 'team-7': team(7), 'team-8': team(8), 'team-9': team(9) },
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-25', sourceReference: '2026-09-22', plan, runTransaction: fakeRunTransaction(db),
  });
  assert.equal(result.committed, true);
  assert.equal(Object.keys(db['2026-09-22']).length, 0);
  assert.deepEqual(Object.values(db['2026-09-25']).map(item => item.space).sort(), [7, 8, 9]);
});

test('拖放幾何：表格外放開不得產生搬移目標', () => {
  const box = { firstTop: 100, lastBottom: 200, rowHeight: 10 };
  assert.equal(resolveDropSlot({ clientY: 99, slotCount: 10, ...box }), null, '表格上方放開 → 無目標');
  assert.equal(resolveDropSlot({ clientY: 201, slotCount: 10, ...box }), null, '表格下方放開 → 無目標');
  assert.equal(resolveDropSlot({ clientY: 100, slotCount: 10, ...box }), 0);
  assert.equal(resolveDropSlot({ clientY: 155, slotCount: 10, ...box }), 5);
  assert.equal(resolveDropSlot({ clientY: 200, slotCount: 10, ...box }), 9, '最底緣吸附最後一格');
  assert.equal(resolveDropSlot({ clientY: 150, rowHeight: 0, firstTop: 100, lastBottom: 200, slotCount: 10 }), null);
  assert.equal(resolveDropSlot({ clientY: Number.NaN, slotCount: 10, ...box }), null);
  assert.equal(resolveDropSlot({}), null);
});

test('拖放幾何：場地欄位以水平位置判定，左右外側不判定', () => {
  const rects = [
    { left: 0, right: 50 },
    { left: 50, right: 100 },
    { left: 100, right: 150 },
  ];
  assert.equal(resolveDropSpace({ clientX: 25, rects }), 1);
  assert.equal(resolveDropSpace({ clientX: 100, rects }), 2, '欄位右邊界屬於該欄');
  assert.equal(resolveDropSpace({ clientX: 150, rects }), 3);
  assert.equal(resolveDropSpace({ clientX: -1, rects }), null, '最左外側（時間欄）不判定');
  assert.equal(resolveDropSpace({ clientX: 151, rects }), null);
  assert.equal(resolveDropSpace({ clientX: Number.NaN, rects }), null);
  assert.equal(resolveDropSpace({ clientX: 10, rects: null }), null);
  assert.equal(resolveDropSpace({ clientX: 10, rects: [null, { left: 0, right: 20 }] }), 2, '空欄位略過');
});

test('跨日搬移：來源刪除失敗且目標紀錄被併發修改時，強制補償刪除不留重複', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 4, makeId: () => `new-${++n}` });
  assert.equal(plan.rollbackForceMutation.forceRemove, true, '補償必須有不帶版本檢查的備援');
  const db = {
    '2026-09-23': {},
    '2026-09-22': { 'coach-1': coach({ time: '11:00' }) },
  };
  const base = fakeRunTransaction(db);
  let tampered = false;
  const wrapped = async (reference, updater) => {
    const result = await base(reference, updater);
    if (!tampered && reference === '2026-09-23' && result.committed && db['2026-09-23']['new-1']) {
      tampered = true;
      db['2026-09-23']['new-1'] = { ...db['2026-09-23']['new-1'], time: '11:00' };
    }
    return result;
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-23', sourceReference: '2026-09-22', plan, runTransaction: wrapped,
  });
  assert.equal(result.committed, false);
  assert.equal(result.reason, 'booking-changed');
  assert.equal(result.rolledBack, true, '即使目標被改過也要補償成功');
  assert.equal(result.forcedRollback, true);
  assert.equal(db['2026-09-23']['new-1'], undefined, '不得留下重複排課');
  assert.equal(db['2026-09-22']['coach-1'].time, '11:00', '來源維持他人修改後的值');
});

test('跨日搬移：目標新資料已被刪除時，強制補償視為已還原且不報錯', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 4, makeId: () => `new-${++n}` });
  const db = {
    '2026-09-23': {},
    '2026-09-22': { 'coach-1': coach({ time: '11:00' }) },
  };
  const base = fakeRunTransaction(db);
  let removed = false;
  const wrapped = async (reference, updater) => {
    const result = await base(reference, updater);
    if (!removed && reference === '2026-09-23' && result.committed && db['2026-09-23']['new-1']) {
      removed = true;
      delete db['2026-09-23']['new-1'];
    }
    return result;
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-23', sourceReference: '2026-09-22', plan, runTransaction: wrapped,
  });
  assert.equal(result.committed, false);
  assert.equal(result.rolledBack, true, '目標已無資料＝已達成不留下重複');
  assert.equal(result.forcedRollback, true);
  assert.equal(db['2026-09-23']['new-1'], undefined);
  assert.equal(db['2026-09-22']['coach-1'].time, '11:00');
});

test('跨日搬移：團課補償遇到目標其中一筆被併發刪除，仍強制刪除整組（不留重複）', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({
    originalRecords: [team(7), team(8), team(9)], targetDate: '2026-09-25', targetSpace: 7, makeId: () => `new-${++n}`,
  });
  const db = {
    '2026-09-25': {},
    '2026-09-22': { 'team-7': team(7), 'team-8': team(8), 'team-9': team(9, { time: '19:30' }) },
  };
  const base = fakeRunTransaction(db);
  let tampered = false;
  const wrapped = async (reference, updater) => {
    const result = await base(reference, updater);
    if (!tampered && reference === '2026-09-25' && result.committed && db['2026-09-25']['new-3']) {
      tampered = true;
      delete db['2026-09-25']['new-3'];
    }
    return result;
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-25', sourceReference: '2026-09-22', plan, runTransaction: wrapped,
  });
  assert.equal(result.committed, false);
  assert.equal(result.rolledBack, true, '團課整組必須清乾淨');
  assert.equal(result.forcedRollback, true);
  assert.deepEqual(Object.keys(db['2026-09-25']), [], '不得留下任何重複團課紀錄');
  assert.equal(Object.keys(db['2026-09-22']).length, 3, '來源維持三筆');
});

test('跨日搬移：來源交易拋出例外時仍要強制補償刪除目標（不留重複）', async () => {
  let n = 0;
  const plan = buildBookingMovePlan({ originalRecords: [coach()], targetDate: '2026-09-23', targetSpace: 4, makeId: () => `new-${++n}` });
  const db = {
    '2026-09-23': {},
    '2026-09-22': { 'coach-1': coach() },
  };
  const base = fakeRunTransaction(db);
  let thrown = false;
  const wrapped = async (reference, updater) => {
    if (!thrown && reference === '2026-09-22') { thrown = true; throw new Error('network down'); }
    return base(reference, updater);
  };
  const result = await commitBookingMove({
    targetReference: '2026-09-23', sourceReference: '2026-09-22', plan, runTransaction: wrapped,
  });
  assert.equal(result.committed, false);
  assert.equal(result.rolledBack, true, '例外路徑也必須補償');
  assert.equal(db['2026-09-23']['new-1'], undefined, '不得留下重複');
  assert.equal(db['2026-09-22']['coach-1'].time, '10:00', '來源未被刪除');
});
