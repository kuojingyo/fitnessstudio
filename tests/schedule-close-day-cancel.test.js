import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createLocalScheduleStorage } from '../src/schedule-local-storage.js';

const source = readFileSync(new URL('../src/schedule-redesign.js', import.meta.url), 'utf8');
const start = source.indexOf('async function toggleClosedDay(dateKey) {');
const end = source.indexOf('function boot()', start);
assert.ok(start >= 0 && end > start);
async function closeFixture({ fallback = false, confirmed = true, closed = false, failed = false, date = '2026-09-17' } = {}) {
  const writes = [], messages = [], confirms = [];
  const bookings = { [date]: [{ id: 'admin', kind: 'admin' }, { id: 'coach', kind: 'coach' }, { id: 'team', kind: 'team' }, { id: 'draft', kind: 'admin', draft: true }], '2026-09-18': [{ id: 'other' }] };
  const initialClosed = closed ? { [date]: { closedBy: '老闆' } } : {};
  const stored = new Map([['bookings', JSON.stringify(bookings)], ['closed', JSON.stringify(initialClosed)]]);
  const storageWrites = [];
  const storage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => { storageWrites.push(key); if (failed) throw new Error('storage full'); stored.set(key, value); } };
  const localScheduleStorage = createLocalScheduleStorage(() => storage, 'state', ['bookings', 'closed'], callback => Promise.resolve().then(callback));
  localScheduleStorage.getItems();
  const context = {
    isBossManager: () => true, mutationInProgress: false, isDataReady: () => true,
    isDateClosed: () => closed, window: { confirm: message => { confirms.push(message); return confirmed; } },
    useFallback: fallback, closedDays: initialClosed, rawBookings: bookings,
    CLOSED_DAYS_FALLBACK_KEY: 'closed', FALLBACK_KEY: 'bookings', ROOT_PATH: 'scheduleV2Bookings', CLOSED_DAYS_ROOT: 'scheduleV2ClosedDays',
    localScheduleStorage,
    db: {}, firebaseApi: { ref: (_db, path = '') => path, update: async (ref, value) => { if (failed) throw new Error('network'); writes.push({ ref, value }); }, set: async (ref, value) => { writes.push({ ref, value }); }, remove: async ref => writes.push({ ref, remove: true }) },
    showToast: message => messages.push(message), renderCurrentView: () => {}, console: { error: () => {} }, date,
  };
  vm.runInNewContext(`${source.slice(start, end)}\npending = toggleClosedDay(date);`, context);
  await context.pending;
  return { context, writes, messages, confirms, stored, storageWrites };
}

test('設定休館：單次原子更新取消當日全部課程、行政與預排班', async () => {
  const { writes, confirms } = await closeFixture();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ref, '');
  assert.equal(writes[0].value['scheduleV2Bookings/2026-09-17'], null);
  assert.equal(writes[0].value['scheduleV2ClosedDays/2026-09-17'].closedBy, '老闆');
  assert.match(confirms[0], /取消/);
  assert.match(confirms[0], /預排/);
});

test('本機模式取消當日全部排班且保留其他日期', async () => {
  const { context, storageWrites } = await closeFixture({ fallback: true });
  assert.equal(context.rawBookings['2026-09-17'], undefined);
  assert.ok(context.rawBookings['2026-09-18']);
  assert.equal(JSON.parse(context.localScheduleStorage.getItem('bookings'))['2026-09-17'], undefined);
  assert.ok(JSON.parse(context.localScheduleStorage.getItem('closed'))['2026-09-17']);
  assert.deepEqual(storageWrites, ['state']);
});

test('取消確認不寫入、不取消排班', async () => {
  const { context, writes } = await closeFixture({ confirmed: false });
  assert.equal(writes.length, 0);
  assert.ok(context.rawBookings['2026-09-17']);
});

test('解除休館不恢復已取消排班', async () => {
  const { writes } = await closeFixture({ closed: true });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].ref, 'scheduleV2ClosedDays/2026-09-17');
  assert.equal(writes[0].remove, true);
});

test('雲端寫入失敗不回報成功且解除操作鎖', async () => {
  const { context, messages } = await closeFixture({ failed: true });
  assert.ok(messages.some(message => message.includes('失敗')));
  assert.equal(context.mutationInProgress, false);
});

test('本機所有儲存皆失敗也無半成品，不依賴可失敗的回滾', async () => {
  const { context, stored, messages, storageWrites } = await closeFixture({ fallback: true, failed: true });
  assert.deepEqual(storageWrites, ['state']);
  assert.equal(stored.has('state'), false);
  assert.deepEqual(JSON.parse(stored.get('closed')), {});
  assert.ok(JSON.parse(stored.get('bookings'))['2026-09-17']);
  assert.ok(context.rawBookings['2026-09-17']);
  assert.ok(messages.some(message => message.includes('失敗')));
});

test('未來日期也取消排班，不設過去日期限制', async () => {
  const { writes } = await closeFixture({ date: '2099-01-01' });
  assert.equal(writes[0].value['scheduleV2Bookings/2099-01-01'], null);
});
