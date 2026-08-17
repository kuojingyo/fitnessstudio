import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInboxMessage, normalizeInbox, unreadCount, withAllRead, withMessageRead, withoutMessage, withoutReadMessages } from '../src/schedule-inbox.js';

const validArgs = {
  id: 'm1', to: '潘閱滔', from: '史昕銓', kind: 'admin',
  date: '2026-08-18', time: '09:00', duration: 60, space: 1, createdAt: 100,
};

test('建立正常收件箱訊息', () => {
  const message = buildInboxMessage(validArgs);
  assert.deepEqual(message, {
    id: 'm1', to: '潘閱滔', from: '史昕銓', kind: 'admin',
    date: '2026-08-18', time: '09:00', duration: 60, space: 1,
    read: false, createdAt: 100,
  });
});

test('收件箱訊息預設未讀且 createdAt 預設為現在', () => {
  const message = buildInboxMessage({ ...validArgs, createdAt: undefined });
  assert.equal(message.read, false);
  assert.ok(Number.isInteger(message.createdAt));
});

test('拒絕畸形收件箱訊息', () => {
  const cases = [
    { ...validArgs, id: '__proto__' },
    { ...validArgs, id: '' },
    { ...validArgs, to: '' },
    { ...validArgs, from: '  ' },
    { ...validArgs, kind: 'magic' },
    { ...validArgs, date: '2026-8-18' },
    { ...validArgs, time: '9:00' },
    { ...validArgs, duration: 0 },
    { ...validArgs, duration: 1.5 },
    { ...validArgs, space: 0 },
    { ...validArgs, space: 10 },
    { ...validArgs, space: '1e0' },
  ];
  for (const args of cases) {
    assert.equal(buildInboxMessage(args), null, JSON.stringify(args));
  }
});

test('未讀計數：物件與陣列都支援', () => {
  const messages = {
    a: { id: 'a', read: false },
    b: { id: 'b', read: true },
    c: { id: 'c', read: false },
  };
  assert.equal(unreadCount(messages), 2);
  assert.equal(unreadCount(Object.values(messages)), 2);
  assert.equal(unreadCount(null), 0);
  assert.equal(unreadCount(undefined), 0);
});

test('標記單筆已讀不修改原物件', () => {
  const messages = { a: { id: 'a', read: false }, b: { id: 'b', read: false } };
  const next = withMessageRead(messages, 'a');
  assert.equal(messages.a.read, false, '原物件不變');
  assert.equal(next.a.read, true);
  assert.equal(next.b.read, false);
  assert.notEqual(next, messages);
});

test('標記不存在的訊息已讀時原樣回傳', () => {
  const messages = { a: { id: 'a', read: false } };
  const next = withMessageRead(messages, 'zzz');
  assert.deepEqual(next, messages);
});

test('全部標記已讀', () => {
  const messages = { a: { id: 'a', read: false }, b: { id: 'b', read: true } };
  const next = withAllRead(messages);
  assert.equal(next.a.read, true);
  assert.equal(next.b.read, true);
  assert.notEqual(next, messages);
});

test('normalizeInbox 過濾畸形資料並保留有效訊息', () => {
  const data = {
    '潘閱滔': {
      ok: { id: 'ok', to: '潘閱滔', from: '史昕銓', kind: 'coach', date: '2026-08-18', time: '09:00', duration: 60, space: 2, read: false, createdAt: 1 },
      bad: { id: 'bad', to: '潘閱滔', from: '史昕銓', kind: 'coach', date: '2026-8-18', time: '09:00', duration: 60, space: 2 },
      garbage: 'not-an-object',
      danger: { id: '__proto__', to: '潘閱滔', from: '史昕銓', kind: 'coach', date: '2026-08-18', time: '09:00', duration: 60, space: 2 },
    },
    '史昕銓': null,
  };
  const normalized = normalizeInbox(data);
  assert.deepEqual(Object.keys(normalized['潘閱滔']), ['ok']);
  assert.deepEqual(normalized['史昕銓'], undefined);
});

test('normalizeInbox 接受陣列並以 id 為鍵', () => {
  const normalized = normalizeInbox({
    '潘閱滔': [
      { id: 'a', to: '潘閱滔', from: '史昕銓', kind: 'admin', date: '2026-08-18', time: '09:00', duration: 60, space: 1 },
    ],
  });
  assert.deepEqual(Object.keys(normalized['潘閱滔']), ['a']);
});

test('拒絕時間超出範圍的收件箱訊息', () => {
  assert.equal(buildInboxMessage({ ...validArgs, time: '99:99' }), null);
  assert.equal(buildInboxMessage({ ...validArgs, time: '09:60' }), null);
  assert.equal(buildInboxMessage({ ...validArgs, time: '24:00' }), null);
});

test('normalizeInbox 過濾危險使用者鍵', () => {
  const payload = JSON.parse('{"__proto__":{"x":{"id":"x","to":"潘閱滔","from":"史昕銓","kind":"coach","date":"2026-08-18","time":"09:00","duration":60,"space":2}},"潘閱滔":{"a":{"id":"a","to":"潘閱滔","from":"史昕銓","kind":"coach","date":"2026-08-18","time":"09:00","duration":60,"space":2}}}');
  const normalized = normalizeInbox(payload);
  assert.deepEqual(Object.keys(normalized), ['潘閱滔']);
  assert.equal(Object.getPrototypeOf(normalized) === Object.prototype, true);
});

test('重疊通知訊息：overlap kind 與 remark 選填欄位', () => {
  const message = buildInboxMessage({
    ...validArgs, kind: 'overlap',
    remark: '與 10:00–11:15 的一般教練課重疊',
  });
  assert.equal(message.kind, 'overlap');
  assert.equal(message.remark, '與 10:00–11:15 的一般教練課重疊');

  const withoutRemark = buildInboxMessage({ ...validArgs, kind: 'overlap' });
  assert.equal('remark' in withoutRemark, false, '無 remark 時不寫入欄位');

  const blankRemark = buildInboxMessage({ ...validArgs, kind: 'overlap', remark: '   ' });
  assert.equal('remark' in blankRemark, false, '空白 remark 不寫入');

  assert.equal(buildInboxMessage({ ...validArgs, remark: 'x'.repeat(201) }), null, '超過 200 字元拒絕');
});

test('normalizeInbox 保留已讀狀態，不重置為未讀', () => {
  const normalized = normalizeInbox({
    '潘閱滔': {
      a: { id: 'a', to: '潘閱滔', from: '史昕銓', kind: 'coach', date: '2026-08-18', time: '09:00', duration: 60, space: 2, read: true, createdAt: 1 },
      b: { id: 'b', to: '潘閱滔', from: '史昕銓', kind: 'coach', date: '2026-08-18', time: '10:00', duration: 60, space: 2, read: false, createdAt: 2 },
    },
  });
  assert.equal(normalized['潘閱滔']['a'].read, true, '已讀訊息載入後必須保持已讀');
  assert.equal(normalized['潘閱滔']['b'].read, false, '未讀訊息維持未讀');
});

test('buildInboxMessage 接受 read 參數（預設 false）', () => {
  assert.equal(buildInboxMessage({ ...validArgs, read: true }).read, true);
  assert.equal(buildInboxMessage(validArgs).read, false);
});

test('withoutMessage 刪除指定訊息且不修改原物件', () => {
  const messages = { a: { id: 'a', read: false }, b: { id: 'b', read: true } };
  const next = withoutMessage(messages, 'a');
  assert.deepEqual(Object.keys(next), ['b']);
  assert.deepEqual(Object.keys(messages), ['a', 'b'], '原物件不變');
  assert.notEqual(next, messages);
});

test('withoutMessage 刪除不存在的訊息時原樣回傳', () => {
  const messages = { a: { id: 'a', read: false } };
  assert.equal(withoutMessage(messages, 'zzz'), messages);
});

test('withoutReadMessages 移除所有已讀並保留未讀', () => {
  const messages = { a: { id: 'a', read: false }, b: { id: 'b', read: true }, c: { id: 'c', read: true } };
  const next = withoutReadMessages(messages);
  assert.deepEqual(Object.keys(next), ['a']);
  assert.deepEqual(Object.keys(messages), ['a', 'b', 'c'], '原物件不變');
  assert.notEqual(next, messages);
});

test('withoutReadMessages 全未讀時原樣回傳', () => {
  const messages = { a: { id: 'a', read: false } };
  assert.equal(withoutReadMessages(messages), messages);
});
