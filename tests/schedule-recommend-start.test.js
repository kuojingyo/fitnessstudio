import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasOffGridBookingBoundary,
  findNearestStart,
} from '../src/schedule-booking-rules.js';

const booking = (time, duration, bufferMinutes = 0) => ({ time, duration, bufferMinutes });

test('偵測範圍內是否出現非 15 分鐘對齊的排課端點（含緩衝）', () => {
  // T = 11:00（偏移 120）→ 檢查範圍 [105, 135]
  assert.equal(
    hasOffGridBookingBoundary([booking('10:00', 60, 5)], { from: 105, to: 135 }),
    true,
    '前一堂 60＋5 的結尾 11:05 落在範圍內',
  );
  assert.equal(
    hasOffGridBookingBoundary([booking('10:00', 60, 0)], { from: 105, to: 135 }),
    false,
    '60＋0 端點全部對齊 15 分鐘',
  );
  assert.equal(
    hasOffGridBookingBoundary([booking('10:00', 75, 0)], { from: 105, to: 135 }),
    false,
    '75（舊）端點也對齊 15 分鐘',
  );
  assert.equal(
    hasOffGridBookingBoundary([booking('11:05', 60, 0)], { from: 90, to: 135 }),
    true,
    '11:05 開始的課屬於非對齊端點',
  );
  assert.equal(
    hasOffGridBookingBoundary([booking('10:00', 60, 5)], { from: 200, to: 230 }),
    false,
    '距離太遠的排課不觸發',
  );
  assert.equal(
    hasOffGridBookingBoundary([booking('10:55', 30, 5)], { from: 105, to: 135 }),
    true,
    '與範圍相交且端點非對齊（10:55–11:30）',
  );
  assert.equal(
    hasOffGridBookingBoundary([], { from: 105, to: 135 }),
    false,
  );
  assert.equal(
    hasOffGridBookingBoundary([booking('10:00', 60, 5)], { from: 135, to: 165 }),
    false,
    '邊界正好相切不算相交（11:05 尾端 < 11:15 範圍起點）',
  );
});

test('findNearestStart 從目標時間往後找最近可排的 5 分鐘格', () => {
  // 11:00（120）被佔到 11:05（125）→ 推薦 11:05
  const occupiedUntil125 = m => m >= 125;
  assert.equal(findNearestStart({ from: 120, maxFrom: 775, canPlace: occupiedUntil125 }), 125);

  // 目標本身可排 → 用目標
  assert.equal(findNearestStart({ from: 120, maxFrom: 775, canPlace: m => m === 120 }), 120);

  // 往前也不行（例如 118 可排）時，往後仍優先
  assert.equal(findNearestStart({ from: 120, maxFrom: 775, canPlace: m => m === 118 || m >= 130 }), 130);

  // 找不到 → null
  assert.equal(findNearestStart({ from: 700, maxFrom: 720, canPlace: () => false }), null);

  // 步進為 5 分鐘
  assert.equal(findNearestStart({ from: 125, maxFrom: 775, canPlace: m => m === 135 }), 135);

  // 邊界：maxFrom 不含之後
  assert.equal(findNearestStart({ from: 130, maxFrom: 130, canPlace: m => m === 135 }), null);
});
