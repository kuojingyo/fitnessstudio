import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_COACH_DURATIONS,
  ALLOWED_COACH_BUFFERS,
  COACH_DURATION_VALUES,
  DEFAULT_COACH_DURATION_VALUE,
  coachDurationOptions,
  coachDurationValueFor,
  parseCoachDurationValue,
  isAllowedBookingDuration,
  isAllowedCoachDuration,
  isAllowedCoachDurationBuffer,
  isBookingStartInDayRange,
  isBookingEndWithinNightLimit,
  dayBookingRowspan,
  timeToMinute,
  minuteToTime,
} from '../src/schedule-booking-rules.js';

test('教練課時長選項為 60＋0／60＋5／60＋10／60＋15／90，預設 60＋15', () => {
  assert.deepEqual(COACH_DURATION_VALUES, ['60+0', '60+5', '60+10', '60+15', '90']);
  assert.equal(DEFAULT_COACH_DURATION_VALUE, '60+15');
  assert.deepEqual(coachDurationOptions(), ['60+0', '60+5', '60+10', '60+15', '90']);
});

test('時長選項值可解析為 duration＋buffer', () => {
  assert.deepEqual(parseCoachDurationValue('60+0'), { duration: 60, buffer: 0 });
  assert.deepEqual(parseCoachDurationValue('60+5'), { duration: 60, buffer: 5 });
  assert.deepEqual(parseCoachDurationValue('60+10'), { duration: 60, buffer: 10 });
  assert.deepEqual(parseCoachDurationValue('60+15'), { duration: 60, buffer: 15 });
  assert.deepEqual(parseCoachDurationValue('90'), { duration: 90, buffer: 0 });
  assert.equal(parseCoachDurationValue('65'), null, '非白名單時長值不得解析');
  assert.equal(parseCoachDurationValue('60+20'), null);
  assert.equal(parseCoachDurationValue('75'), null, '75 不再作為選項值');
  assert.equal(parseCoachDurationValue(''), null);
  assert.equal(parseCoachDurationValue(null), null);
});

test('既有排課轉換為選項值：60＋X 照實、舊 75 視為 60＋15、90 不變', () => {
  assert.equal(coachDurationValueFor({ duration: 60, bufferMinutes: 0 }), '60+0');
  assert.equal(coachDurationValueFor({ duration: 60, bufferMinutes: 5 }), '60+5');
  assert.equal(coachDurationValueFor({ duration: 60, bufferMinutes: 15 }), '60+15');
  assert.equal(coachDurationValueFor({ duration: 60 }), '60+0', '缺 buffer 欄位視為 0');
  assert.equal(coachDurationValueFor({ duration: 75 }), '60+15', '舊 75 分鐘資料以 60＋15 呈現');
  assert.equal(coachDurationValueFor({ duration: 90 }), '90');
  assert.equal(coachDurationValueFor({ duration: 90, bufferMinutes: 0 }), '90');
  assert.equal(coachDurationValueFor({ duration: 65 }), null);
});

test('白名單仍保留 60／75：既有資料未經編輯前可正常載入與寫入', () => {
  assert.deepEqual(ALLOWED_COACH_DURATIONS, [60, 75, 90]);
  assert.deepEqual(ALLOWED_COACH_BUFFERS, [0, 5, 10, 15]);
  assert.equal(isAllowedCoachDuration(60), true);
  assert.equal(isAllowedCoachDuration(75), true);
  assert.equal(isAllowedCoachDuration(90), true);
  assert.equal(isAllowedCoachDuration(30), false);
  assert.equal(isAllowedCoachDuration('90'), false);
});

test('時長＋緩衝組合：60 可帶 0／5／10／15；75（舊）與 90 僅能無緩衝', () => {
  assert.equal(isAllowedCoachDurationBuffer(60, 0), true);
  assert.equal(isAllowedCoachDurationBuffer(60, 5), true);
  assert.equal(isAllowedCoachDurationBuffer(60, 10), true);
  assert.equal(isAllowedCoachDurationBuffer(60, 15), true);
  assert.equal(isAllowedCoachDurationBuffer(60, 20), false, '緩衝白名單外');
  assert.equal(isAllowedCoachDurationBuffer(75, 0), true, '舊 75 無緩衝');
  assert.equal(isAllowedCoachDurationBuffer(75, 5), false);
  assert.equal(isAllowedCoachDurationBuffer(90, 0), true);
  assert.equal(isAllowedCoachDurationBuffer(90, 5), false, '90 不得帶緩衝');
  assert.equal(isAllowedCoachDurationBuffer(65, 0), false);
  assert.equal(isAllowedCoachDurationBuffer(60, undefined), false, '未給緩衝時不得隱含通過');
});

test('前端載入正規化：行政限制 30–240；教練課 60＋緩衝或 75／90；團課不得帶緩衝', () => {
  assert.equal(isAllowedBookingDuration(1, 45), true, '行政時段 45 分鐘仍可載入');
  assert.equal(isAllowedBookingDuration(1, 240), true);
  assert.equal(isAllowedBookingDuration(1, 90), true);
  assert.equal(isAllowedBookingDuration(1, 15), false, '行政時段 15 分鐘不得載入');
  assert.equal(isAllowedBookingDuration(1, 255), false, '行政時段 255 分鐘不得載入');
  assert.equal(isAllowedBookingDuration(2, 60), true);
  assert.equal(isAllowedBookingDuration(2, 60, 5), true);
  assert.equal(isAllowedBookingDuration(2, 60, 10, 'coach'), true);
  assert.equal(isAllowedBookingDuration(2, 60, 20), false, '緩衝白名單外一律拒絕');
  assert.equal(isAllowedBookingDuration(2, 75), true, '既有 75 分鐘資料仍可載入');
  assert.equal(isAllowedBookingDuration(2, 75, 5), false, '75 不得帶緩衝');
  assert.equal(isAllowedBookingDuration(2, 90), true);
  assert.equal(isAllowedBookingDuration(2, 90, 5), false, '90 不得帶緩衝');
  assert.equal(isAllowedBookingDuration(7, 75, 0, 'team'), true, '團課既有 75 分鐘仍可載入');
  assert.equal(isAllowedBookingDuration(7, 90, 0, 'team'), true);
  assert.equal(isAllowedBookingDuration(7, 60, 5, 'team'), false, '團課不支援 60＋緩衝');
  assert.equal(isAllowedBookingDuration(7, 60, 5, 'coach'), true, '同場地的教練課可使用 60＋5');
  assert.equal(isAllowedBookingDuration(3, 105), false, '白名單外的教練課時長不得載入');
  assert.equal(isAllowedBookingDuration(7, 30, 0, 'team'), false, '白名單外的團課時長不得載入');
});

test('教練課允許 09:00 起以 5 分鐘為單位；團課與行政維持 15 分鐘', () => {
  assert.equal(isBookingStartInDayRange('09:00'), true);
  assert.equal(isBookingStartInDayRange('21:45'), true);
  assert.equal(isBookingStartInDayRange('22:00'), false);
  assert.equal(isBookingStartInDayRange('11:05', { slotMinutes: 5 }), true, '教練課可於 11:05 開始');
  assert.equal(isBookingStartInDayRange('21:55', { slotMinutes: 5 }), true, '教練課最晚 21:55 開始');
  assert.equal(isBookingStartInDayRange('11:07', { slotMinutes: 5 }), false, '非 5 分鐘倍數拒絕');
  assert.equal(isBookingStartInDayRange('11:05'), false, '15 分鐘模式下 11:05 不合法');
});

test('日檢視 rowspan 以「課程本身」計算（不含緩衝），52 格參數仍會截斷到 22:00', () => {
  assert.equal(dayBookingRowspan('21:30', 90, 52), 2);
  assert.equal(dayBookingRowspan('21:45', 60, 52), 1);
  assert.equal(dayBookingRowspan('10:00', 75, 52), 5);
  assert.equal(dayBookingRowspan('10:00', 60, 52), 4, '60 分鐘佔 4 格；緩衝由卡片尾巴呈現，不佔下一堂的起點格');
  assert.equal(dayBookingRowspan('11:05', 60, 52), 5, '11:05–12:05 覆蓋 11:00–12:15 共 5 格');
  assert.equal(dayBookingRowspan('21:00', 60, 52), 4, '21:00 起 60 分鐘截到 22:00');
  assert.equal(dayBookingRowspan('21:45', 90, 52), 1, '超過 22:00 的部分截斷');
});

test('日檢視格線延伸到午夜（60 格）時，22:00 後的課程完整顯示不再截斷', () => {
  assert.equal(dayBookingRowspan('21:10', 60, 60), 5, '21:10–22:10 覆蓋 21:00–22:15 共 5 格');
  assert.equal(dayBookingRowspan('21:00', 60, 60), 4, '21:00–22:00 佔 4 格');
  assert.equal(dayBookingRowspan('21:45', 60, 60), 4, '21:45–22:45 共 4 格');
  assert.equal(dayBookingRowspan('21:45', 90, 60), 6, '21:45–23:15 共 6 格');
  assert.equal(dayBookingRowspan('10:00', 60, 60), 4);
});

test('晚間排課最晚只能到午夜，不可跨到隔天（含緩衝）', () => {
  assert.equal(isBookingEndWithinNightLimit(750, 90, 0), true, '21:30 起 90 分鐘（至 23:00）允許');
  assert.equal(isBookingEndWithinNightLimit(765, 90, 0), true, '21:45 起 90 分鐘（至 23:15）允許');
  assert.equal(isBookingEndWithinNightLimit(750, 60, 15), true, '21:30 起 60＋15（至 22:45）允許');
  assert.equal(isBookingEndWithinNightLimit(765, 60, 15), true, '21:45 起 60＋15（至 23:00）允許');
  assert.equal(isBookingEndWithinNightLimit(840, 60, 0), true, '23:00 起 60 分鐘（至 24:00）允許');
  assert.equal(isBookingEndWithinNightLimit(840, 60, 5), false, '23:00 起 60＋5 跨日，拒絕');
  assert.equal(isBookingEndWithinNightLimit(765, 240, 0), false, '21:45 起 240 分鐘跨日，拒絕');
});

test('時間格式驗證拒絕非法分鐘（例如 09:60）', () => {
  assert.equal(isBookingStartInDayRange('09:60'), false);
  assert.equal(isBookingStartInDayRange('21:75'), false);
  assert.equal(isBookingStartInDayRange('09:15'), true);
});

test('時間與偏移分鐘互轉：以 09:00 為基準、支援 5 分鐘粒度', () => {
  assert.equal(timeToMinute('09:00'), 0);
  assert.equal(timeToMinute('09:05'), 5);
  assert.equal(timeToMinute('11:05'), 125);
  assert.equal(timeToMinute('22:00'), 780);
  assert.equal(timeToMinute('23:59'), 899);
  assert.equal(timeToMinute('24:00'), null);
  assert.equal(timeToMinute('09:60'), null);
  assert.equal(timeToMinute(''), null);
  assert.equal(minuteToTime(0), '09:00');
  assert.equal(minuteToTime(125), '11:05');
  assert.equal(minuteToTime(775), '21:55');
  assert.equal(minuteToTime(900), '24:00');
});
