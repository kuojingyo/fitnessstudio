import test from 'node:test';
import assert from 'node:assert/strict';
import * as tx from '../src/schedule-booking-transaction.js';

import {
  applyDateBookingMutation,
  bookingMutationExpectedValues,
  buildDateBookingMutation,
} from '../src/schedule-booking-transaction.js';

const adminBooking = (id, time = '09:00', duration = 60, extra = {}) => ({
  id,
  date: '2026-08-13',
  space: 1,
  owner: id,
  kind: 'admin',
  time,
  duration,
  ...extra,
});

const mutationFor = booking => ({
  removeIds: [],
  additions: [booking],
  replacements: [],
});

test('草稿排課僅限行政時段，其他空間的草稿會被拒絕', () => {
  const booking = {
    id: 'draft-coach', date: '2026-08-13', space: 2, owner: '潘閱滔',
    kind: 'coach', time: '09:00', duration: 75, draft: true,
  };

  const result = applyDateBookingMutation({}, mutationFor(booking));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-booking-data');
});

test('草稿標記只接受嚴格 true，畸形值會被拒絕', () => {
  for (const [index, draft] of ['yes', 1, false, 'true'].entries()) {
    const booking = adminBooking(`malformed-draft-${index}`, '09:00', 60, { draft });

    const result = applyDateBookingMutation({}, mutationFor(booking));

    assert.equal(result.ok, false, `draft=${JSON.stringify(draft)} 應被拒絕`);
    assert.equal(result.reason, 'invalid-booking-data');
  }
});

test('正式排課不受草稿阻擋，可排入草稿佔用的同一教練時段', () => {
  const current = {
    draft: adminBooking('draft', '09:00', 60, { owner: '史昕銓', draft: true }),
  };
  const live = adminBooking('live', '09:00', 60, { owner: '史昕銓' });

  const result = applyDateBookingMutation(current, mutationFor(live));

  assert.equal(result.ok, true);
  assert.equal(result.value.live.time, '09:00');
});

test('草稿與正式排課重疊時會被阻擋', () => {
  const current = {
    live: adminBooking('live', '09:00', 60, { owner: '史昕銓' }),
  };
  const draft = adminBooking('draft', '09:00', 60, { owner: '史昕銓', draft: true });

  const result = applyDateBookingMutation(current, mutationFor(draft));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'owner-conflict');
});

test('草稿與草稿重疊時會被阻擋', () => {
  const current = {
    draftA: adminBooking('draftA', '09:00', 60, { owner: '高芷妍', draft: true }),
  };
  const draftB = adminBooking('draftB', '09:30', 60, { owner: '高芷妍', draft: true });

  const result = applyDateBookingMutation(current, mutationFor(draftB));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'owner-conflict');
});

test('草稿不佔用行政容量，正式排課可排入已滿 3 筆草稿的時段', () => {
  const current = {
    draftA: adminBooking('draftA', '09:00', 60, { owner: '史昕銓', draft: true }),
    draftB: adminBooking('draftB', '09:00', 60, { owner: '高芷妍', draft: true }),
    draftC: adminBooking('draftC', '09:00', 60, { owner: '潘閱滔', draft: true }),
  };
  const live = adminBooking('live', '09:00', 60, { owner: '其他', nickname: '代班' });

  const result = applyDateBookingMutation(current, mutationFor(live));

  assert.equal(result.ok, true);
});

test('草稿建立時會計算正式排課的行政容量', () => {
  const current = {
    liveA: adminBooking('liveA', '09:00', 60, { owner: '史昕銓' }),
    liveB: adminBooking('liveB', '09:00', 60, { owner: '高芷妍' }),
    liveC: adminBooking('liveC', '09:00', 60, { owner: '潘閱滔' }),
  };
  const draft = adminBooking('draft', '09:00', 60, { owner: '其他', nickname: '代班', draft: true });

  const result = applyDateBookingMutation(current, mutationFor(draft));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'admin-capacity');
});

test('編輯草稿時未攜帶 draft 欄位仍保留草稿狀態', () => {
  const current = {
    d: adminBooking('d', '09:00', 60, { owner: '史昕銓', draft: true }),
  };
  const mutation = buildDateBookingMutation({
    mode: 'edit',
    originalRecords: [current.d],
    records: [{ ...current.d, time: '10:00' }],
  });

  const result = applyDateBookingMutation(current, mutation);

  assert.equal(result.ok, true);
  assert.equal(result.value.d.time, '10:00');
  assert.equal(result.value.d.draft, true);
});

test('發佈草稿會移除 draft 標記並轉為正式排課', () => {
  const booking = adminBooking('d', '09:00', 60, { owner: '史昕銓', draft: true });
  const mutation = tx.buildPublishDraftMutation(booking);

  assert.ok(mutation, '草稿應產生發佈 mutation');
  const result = applyDateBookingMutation({ d: booking }, mutation);

  assert.equal(result.ok, true);
  assert.equal(result.value.d.draft, undefined);
  assert.equal(result.value.d.time, '09:00');
});

test('發佈草稿時會重新檢查與正式排課的衝突', () => {
  const current = {
    d: adminBooking('d', '09:00', 60, { owner: '史昕銓', draft: true }),
    live: adminBooking('live', '09:00', 60, { owner: '史昕銓' }),
  };
  const mutation = tx.buildPublishDraftMutation(current.d);

  const result = applyDateBookingMutation(current, mutation);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'owner-conflict');
});

test('發佈正式排課會被拒絕', () => {
  const live = adminBooking('live', '09:00', 60, { owner: '史昕銓' });

  assert.equal(tx.buildPublishDraftMutation(live), null);
});

test('草稿已被他處發佈時，編輯會因 CAS 不符而被拒絕', () => {
  const serverDraft = adminBooking('d', '09:00', 60, { owner: '史昕銓', draft: true });
  const staleClientCopy = adminBooking('d', '09:00', 60, { owner: '史昕銓' });
  const mutation = buildDateBookingMutation({
    mode: 'edit',
    originalRecords: [staleClientCopy],
    records: [{ ...staleClientCopy, time: '10:00' }],
  });

  const result = applyDateBookingMutation({ d: serverDraft }, mutation);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'booking-changed');
});

test('草稿發佈後 capacity 只計算正式排課', () => {
  const current = {
    draftA: adminBooking('draftA', '09:00', 60, { owner: '史昕銓', draft: true }),
    liveA: adminBooking('liveA', '09:00', 60, { owner: '高芷妍' }),
    liveB: adminBooking('liveB', '09:00', 60, { owner: '潘閱滔' }),
    liveC: adminBooking('liveC', '09:00', 60, { owner: '其他', nickname: '甲' }),
  };
  const mutation = tx.buildPublishDraftMutation(current.draftA);

  const result = applyDateBookingMutation(current, mutation);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'admin-capacity');
});

test('bookingMutationExpectedValues 包含草稿狀態供 CAS 比對', () => {
  const draft = adminBooking('d', '09:00', 60, { owner: '史昕銓', draft: true });
  const live = adminBooking('l', '09:00', 60, { owner: '史昕銓' });

  assert.equal(bookingMutationExpectedValues(draft).draft, true);
  assert.equal(bookingMutationExpectedValues(live).draft, undefined);
});

test('引擎層編輯草稿省略 draft 欄位仍受行政容量限制', () => {
  const current = {
    d: adminBooking('d', '09:00', 60, { owner: '史昕銓', draft: true }),
    liveA: adminBooking('liveA', '09:00', 60, { owner: '高芷妍' }),
    liveB: adminBooking('liveB', '09:00', 60, { owner: '潘閱滔' }),
    liveC: adminBooking('liveC', '09:00', 60, { owner: '其他', nickname: '甲' }),
  };
  const replacement = { ...current.d, remark: '改備註' };
  delete replacement.draft;
  const mutation = buildDateBookingMutation({
    mode: 'edit',
    originalRecords: [current.d],
    records: [replacement],
  });

  const result = applyDateBookingMutation(current, mutation);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'admin-capacity');
});

test('發佈非行政草稿會被拒絕', () => {
  const coachDraft = {
    id: 'cd', date: '2026-08-13', space: 2, owner: '潘閱滔',
    kind: 'coach', time: '09:00', duration: 75, draft: true,
  };

  assert.equal(tx.buildPublishDraftMutation(coachDraft), null);
});

test('日期節點含 draft:null 畸形值時寫入一律中止', () => {
  const current = {
    bad: adminBooking('bad', '10:00', 60, { draft: null }),
  };

  const result = applyDateBookingMutation(
    current,
    mutationFor(adminBooking('new', '11:00', 60, { owner: '史昕銓' })),
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'invalid-booking-data');
});
