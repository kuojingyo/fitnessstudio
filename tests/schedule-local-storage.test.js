import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalScheduleStorage } from '../src/schedule-local-storage.js';
function fixture({ fail = false, empty = false } = {}) {
  const data = new Map(empty ? [] : [['bookings', '{"old":true}'], ['closed', '{}']]);
  const writes = [];
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => { writes.push(key); if (fail) throw new Error('quota'); data.set(key, value); } };
  let queue = Promise.resolve();
  const withLock = callback => { const result = queue.then(callback); queue = result.catch(() => {}); return result; };
  const create = () => createLocalScheduleStorage(() => storage, 'state', ['bookings', 'closed'], withLock);
  return { data, writes, store: create(), create };
}
test('原子本機排課狀態讀取既有獨立鍵，無須先遷移', () => {
  const { store, writes } = fixture();
  assert.equal(store.getItem('bookings'), '{"old":true}');
  assert.equal(store.getItem('closed'), '{}');
  assert.equal(writes.length, 0);
});
test('取消與休館一次 setItem，權威狀態優先於舊鍵', async () => {
  const { store, writes, data } = fixture();
  await store.setItems({ bookings: '{}', closed: '{"date":true}' });
  assert.deepEqual(writes, ['state']);
  assert.equal(store.getItem('bookings'), '{}');
  assert.equal(store.getItem('closed'), '{"date":true}');
  assert.equal(data.get('bookings'), '{"old":true}');
});
test('儲存永遠失敗也不需回滾，排班與休館皆維持原狀', async () => {
  const { store, writes, data } = fixture({ fail: true });
  await assert.rejects(() => store.setItems({ bookings: '{}', closed: '{"date":true}' }), /quota/);
  assert.deepEqual(writes, ['state']);
  assert.equal(data.has('state'), false);
  assert.equal(store.getItem('bookings'), '{"old":true}');
  assert.equal(store.getItem('closed'), '{}');
});
test('後續新增排班或解除休館保留另一份權威資料', async () => {
  const { store } = fixture();
  await store.setItems({ bookings: '{}', closed: '{"date":true}' });
  await store.setItem('bookings', '{"new":true}');
  assert.equal(store.getItem('closed'), '{"date":true}');
  await store.setItem('closed', '{}');
  assert.equal(store.getItem('bookings'), '{"new":true}');
});
test('沒有舊資料時保持 null 與空狀態相容', async () => {
  const { store } = fixture({ empty: true });
  assert.equal(store.getItem('bookings'), null);
  await store.setItem('closed', '{}');
  assert.equal(store.getItem('bookings'), null);
});
test('兩分頁設定不同休館日：舊快照拒絕，不復活已取消排班', async () => {
  const data = new Map([['bookings', '{"old":true}'], ['closed', '{}']]);
  let queue = Promise.resolve();
  const withLock = callback => { const result = queue.then(callback); queue = result.catch(() => {}); return result; };
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const a = createLocalScheduleStorage(() => storage, 'state', ['bookings', 'closed'], withLock);
  const b = createLocalScheduleStorage(() => storage, 'state', ['bookings', 'closed'], withLock);
  a.getItem('bookings'); b.getItem('bookings');
  await a.setItems({ bookings: '{}', closed: '{"dayA":true}' });
  await assert.rejects(async () => b.setItems({ bookings: '{"old":true}', closed: '{"dayB":true}' }), /changed/);
  assert.equal(a.getItem('bookings'), '{}');
  assert.equal(a.getItem('closed'), '{"dayA":true}');
});

test('休館後舊分頁新增、搬移、resize與解除不得覆蓋取消結果', async () => {
  for (const updates of [{ bookings: '{"old":true,"new":true}' }, { bookings: '{"moved":true,"old":true}' }, { bookings: '{"old":"resized"}' }, { closed: '{}' }]) {
    const { store: a, create } = fixture();
    const b = create();
    a.getItems(); b.getItems();
    await a.setItems({ bookings: '{}', closed: '{"dayA":true}' });
    await assert.rejects(() => b.setItems(updates), /changed/);
    assert.equal(a.getItem('bookings'), '{}');
  }
});

test('同時寫入共用鎖：第二筆舊快照拒絕，沒有 lost update', async () => {
  const { store: a, create, writes } = fixture();
  const b = create();
  a.getItems(); b.getItems();
  const results = await Promise.allSettled([a.setItems({ bookings: '{}', closed: '{"dayA":true}' }), b.setItems({ bookings: '{"old":true}', closed: '{"dayB":true}' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(writes.length, 1);
});

test('設定休館→解除→重新讀取不恢復取消資料', async () => {
  const { store, create } = fixture();
  await store.setItems({ bookings: '{}', closed: '{"day":true}' });
  await store.setItem('closed', '{}');
  const fresh = create();
  assert.deepEqual(fresh.getItems(), { bookings: '{}', closed: '{}' });
});

test('缺少跨分頁鎖時拒絕本機寫入，不降級為不安全儲存', async () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const store = createLocalScheduleStorage(() => storage, 'state', ['bookings', 'closed']);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
  try {
    await assert.rejects(() => store.setItem('bookings', '{}'), /Web Locks/);
    assert.equal(data.size, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('拒絕畸形權威狀態及未知鍵，不靜默復活舊排班', async () => {
  const { store, data } = fixture();
  data.set('state', '[]');
  assert.throws(() => store.getItem('bookings'));
  await assert.rejects(() => store.setItem('unknown', '{}'));
});
