import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_COACH_DURATIONS,
  COACH_DURATIONS,
  DEFAULT_COACH_DURATION,
  coachDurationOptions,
  isAllowedBookingDuration,
  isLegacyCoachDuration,
  isAllowedCoachDuration,
  isBookingStartInDayRange,
  isBookingEndWithinNightLimit,
  dayBookingRowspan,
} from '../src/schedule-booking-rules.js';

test('新建教練課與團課提供 60/90 分鐘，預設 60 分鐘', () => {
  assert.deepEqual(COACH_DURATIONS, [60, 90]);
  assert.equal(DEFAULT_COACH_DURATION, 60);
  assert.deepEqual(coachDurationOptions(), [60, 90]);
});

test('編輯既有 75 分鐘課程時保留 75（僅顯示用），不會默默改成 60', () => {
  assert.deepEqual(coachDurationOptions({ editing: true, duration: 75 }), [60, 90, 75]);
  assert.deepEqual(coachDurationOptions({ editing: true, duration: 90 }), [60, 90]);
});

test('75 分鐘不再是可選時長，僅既有 75 分鐘課程以原時長保留', () => {
  assert.equal(isLegacyCoachDuration(75), true);
  assert.equal(isLegacyCoachDuration(60), false, '60 分鐘是現行選項，不可標記為舊時長');
  assert.equal(isLegacyCoachDuration(90), false, '90 分鐘是現行選項，不可標記為舊時長');
  assert.equal(isLegacyCoachDuration('75'), true, '字串型舊資料也要能辨識');
  assert.equal(isAllowedCoachDuration(75), true, '既有 75 分鐘資料仍必須可儲存，編輯時不得失敗');
  assert.deepEqual(coachDurationOptions({ editing: false }), [60, 90], '新建排課絕不出現 75 分鐘');
});

test('教練課與團課允許 09:00 至 21:45 開始，行政時段的結束限制由交易層另行處理', () => {
  assert.equal(isBookingStartInDayRange('09:00'), true);
  assert.equal(isBookingStartInDayRange('21:45'), true);
  assert.equal(isBookingStartInDayRange('22:00'), false);
  assert.equal(isBookingStartInDayRange('21:30'), true);
});

test('日檢視 rowspan 截斷到 22:00，但實際時長仍可延伸', () => {
  assert.equal(dayBookingRowspan('21:30', 90, 52), 2);
  assert.equal(dayBookingRowspan('21:45', 60, 52), 1);
  assert.equal(dayBookingRowspan('10:00', 75, 52), 5);
});

test('晚間排課最晚只能到午夜，不可跨到隔天', () => {
  assert.equal(isBookingEndWithinNightLimit(50, 90), true, '21:30 起 90 分鐘（至 23:00）允許');
  assert.equal(isBookingEndWithinNightLimit(51, 90), true, '21:45 起 90 分鐘（至 23:15）允許');
  assert.equal(isBookingEndWithinNightLimit(50, 60), true, '21:30 起 60 分鐘允許');
  assert.equal(isBookingEndWithinNightLimit(51, 240), false, '21:45 起 240 分鐘會跨到隔天，拒絕');
});

test('時間格式驗證拒絕非法分鐘（例如 09:60）', () => {
  assert.equal(isBookingStartInDayRange('09:60'), false);
  assert.equal(isBookingStartInDayRange('21:75'), false);
  assert.equal(isBookingStartInDayRange('09:15'), true);
});

test('共用時長白名單為 60／75／90 分鐘', () => {
  assert.deepEqual(ALLOWED_COACH_DURATIONS, [60, 75, 90]);
  assert.equal(isAllowedCoachDuration(60), true);
  assert.equal(isAllowedCoachDuration(75), true);
  assert.equal(isAllowedCoachDuration(90), true);
  assert.equal(isAllowedCoachDuration(30), false);
  assert.equal(isAllowedCoachDuration('90'), false);
});

test('前端載入正規化：行政時段限制 30–240 分鐘，教練課與團課僅允許 60／75／90', () => {
  assert.equal(isAllowedBookingDuration(1, 45), true, '行政時段 45 分鐘仍可載入');
  assert.equal(isAllowedBookingDuration(1, 240), true, '行政時段 240 分鐘仍可載入');
  assert.equal(isAllowedBookingDuration(1, 90), true, '行政時段 90 分鐘仍可載入');
  assert.equal(isAllowedBookingDuration(1, 15), false, '行政時段 15 分鐘不得載入');
  assert.equal(isAllowedBookingDuration(1, 255), false, '行政時段 255 分鐘不得載入');
  assert.equal(isAllowedBookingDuration(2, 60), true);
  assert.equal(isAllowedBookingDuration(7, 75), true, '團課既有 75 分鐘仍可載入');
  assert.equal(isAllowedBookingDuration(3, 105), false, '白名單外的教練課時長不得載入');
  assert.equal(isAllowedBookingDuration(7, 30), false, '白名單外的團課時長不得載入');
});
