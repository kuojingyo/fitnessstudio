export const MIN_ADMIN_DURATION = 30;
export const MAX_ADMIN_DURATION = 240;
const SLOT_MINUTES = 15;

// 允許寫入的教練課時長：60（可搭配緩衝，現行）與 90；75 僅為讓既有資料相容而保留白名單
export const ALLOWED_COACH_DURATIONS = [60, 75, 90];
// 教練課課後緩衝（分鐘）：60 分鐘課程可搭配 0／5／10／15
export const ALLOWED_COACH_BUFFERS = [0, 5, 10, 15];
// 排課視窗的教練課時長選項值（課程時長＋緩衝一次選）
export const COACH_DURATION_VALUES = ['60+0', '60+5', '60+10', '60+15', '90'];
export const DEFAULT_COACH_DURATION_VALUE = '60+15';

export function isAllowedCoachDuration(value) {
  return typeof value === 'number' && ALLOWED_COACH_DURATIONS.includes(value);
}

// 時長＋緩衝組合：60 可帶白名單緩衝；75（舊資料）與 90 僅能無緩衝
export function isAllowedCoachDurationBuffer(duration, buffer) {
  if (!Number.isInteger(duration) || !Number.isInteger(buffer)) return false;
  if (!ALLOWED_COACH_DURATIONS.includes(duration)) return false;
  if (!ALLOWED_COACH_BUFFERS.includes(buffer)) return false;
  return duration === 60 || buffer === 0;
}

// 選項值（例如 '60+5'、'90'）→ { duration, buffer }；非法值回傳 null
export function parseCoachDurationValue(value) {
  const text = String(value ?? '');
  if (text === '90') return { duration: 90, buffer: 0 };
  const match = /^60\+(0|5|10|15)$/.exec(text);
  if (!match) return null;
  return { duration: 60, buffer: Number(match[1]) };
}

// 既有排課 → 選項值：60＋X 照實、舊 75 視為 60＋15、90 不變
export function coachDurationValueFor(booking) {
  const duration = Number(booking?.duration);
  const raw = booking?.bufferMinutes;
  const buffer = raw == null || raw === '' ? 0 : Number(raw);
  if (!Number.isInteger(duration) || !Number.isInteger(buffer)) return null;
  if (duration === 60) return ALLOWED_COACH_BUFFERS.includes(buffer) ? `60+${buffer}` : null;
  if (duration === 75 && buffer === 0) return '60+15';
  if (duration === 90 && buffer === 0) return '90';
  return null;
}

// 排課視窗的時長選項：60＋0／60＋5／60＋10／60＋15／90
export function coachDurationOptions() {
  return [...COACH_DURATION_VALUES];
}

// 前端載入正規化與表單驗證共用：行政時段限制 30–240 分鐘；教練課檢查時長＋緩衝組合；團課不得帶緩衝
export function isAllowedBookingDuration(space, duration, buffer = 0, kind = null) {
  if (Number(space) === 1) {
    return typeof duration === 'number'
      && duration >= MIN_ADMIN_DURATION
      && duration <= MAX_ADMIN_DURATION
      && duration % SLOT_MINUTES === 0;
  }
  if (!isAllowedCoachDurationBuffer(duration, buffer)) return false;
  if (kind === 'team') return buffer === 0;
  return true;
}

export function isBookingStartInDayRange(time, { openMinutes = 9 * 60, closeMinutes = 22 * 60, slotMinutes = 15 } = {}) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;
  return minutes < 60 && total >= openMinutes && total < closeMinutes && total % slotMinutes === 0;
}

// 「偏移分鐘」以 09:00 為 0：'11:05' → 125；非法時間回傳 null
export function timeToMinute(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes >= 60) return null;
  return hours * 60 + minutes - 9 * 60;
}

export function minuteToTime(minute) {
  const value = Number(minute);
  if (!Number.isFinite(value)) return null;
  const total = 9 * 60 + value;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// The day card displays occupied time, including any separate post-class buffer.
export function bookingDisplayEndTime(booking) {
  const start = timeToMinute(booking?.time);
  const duration = Number(booking?.duration);
  const buffer = Number(booking?.bufferMinutes ?? 0);
  if (start == null || !Number.isFinite(duration) || !Number.isFinite(buffer)) return null;
  return minuteToTime(start + duration + buffer);
}

// 晚間排課最晚只能到午夜（偏移 900 分鐘 = 24:00），含緩衝不得跨到隔天
export const NIGHT_LIMIT_MINUTE = 15 * 60;

export function isBookingEndWithinNightLimit(startMinutes, duration, buffer = 0, { lastMinute = NIGHT_LIMIT_MINUTE } = {}) {
  const start = Number(startMinutes);
  const total = start + Number(duration) + Number(buffer);
  return Number.isFinite(start) && Number.isFinite(total) && total <= lastMinute;
}

// 日檢視 rowspan：以「課程本身」（不含課後緩衝）向上取整到 15 分鐘格，並截斷到 22:00；
// 課後緩衝由卡片尾巴以絕對定位溢出呈現，不佔用下一堂課的起點格
export function dayBookingRowspan(time, duration, totalSlots = 52) {
  const startMinute = timeToMinute(time);
  const span = Number(duration);
  if (startMinute == null || !Number.isFinite(span) || span <= 0) return 0;
  const startRow = Math.floor(startMinute / SLOT_MINUTES);
  const endRow = Math.ceil((startMinute + span) / SLOT_MINUTES);
  return Math.max(0, Math.min(Number(totalSlots) - startRow, endRow - startRow));
}

// 拖曳放開位置 → 偏移分鐘（吸附到 stepMinutes 五分鐘格；表格外回傳 null）
export function resolveDropMinutes({ clientY, firstTop, lastBottom, rowHeight, totalMinutes = 15 * 60, stepMinutes = 5 } = {}) {
  if (![clientY, firstTop, lastBottom, rowHeight].every(Number.isFinite)) return null;
  if (rowHeight <= 0 || !(totalMinutes > 0) || !(stepMinutes > 0)) return null;
  if (clientY < firstTop || clientY > lastBottom) return null;
  const rawMinutes = ((clientY - firstTop) / rowHeight) * SLOT_MINUTES;
  if (!Number.isFinite(rawMinutes)) return null;
  const snapped = Math.round(rawMinutes / stepMinutes) * stepMinutes;
  return Math.max(0, Math.min(totalMinutes - stepMinutes, snapped));
}

// 檢查 [from, to] 偏移分鐘範圍內，是否有任何排課帶「非 15 分鐘對齊」的開始或結束端點（含緩衝）
export function hasOffGridBookingBoundary(bookings, { from, to } = {}) {
  if (!Array.isArray(bookings) || !Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false;
  for (const booking of bookings) {
    const start = timeToMinute(booking?.time);
    if (start == null) continue;
    const duration = Number(booking?.duration);
    const buffer = Number(booking?.bufferMinutes ?? 0);
    if (!Number.isFinite(duration) || !Number.isFinite(buffer)) continue;
    const end = start + duration + buffer;
    if (start >= to || end <= from) continue;
    if (start % SLOT_MINUTES !== 0 || end % SLOT_MINUTES !== 0) return true;
  }
  return false;
}

// 從 from 起（含）往後，每 step 分鐘找第一個 canPlace 通過的排課起點；找不到回傳 null
export function findNearestStart({ from, maxFrom, step = 5, canPlace } = {}) {
  if (!Number.isFinite(from) || !Number.isFinite(maxFrom) || typeof canPlace !== 'function') return null;
  for (let minute = from; minute <= maxFrom; minute += step) {
    if (canPlace(minute)) return minute;
  }
  return null;
}

export function resolveDropSpace({ clientX, rects } = {}) {
  if (!Number.isFinite(clientX) || !Array.isArray(rects)) return null;
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (!rect) continue;
    const left = Number(rect.left);
    const right = Number(rect.right);
    if (!Number.isFinite(left) || !Number.isFinite(right)) continue;
    if (clientX >= left && clientX <= right) return index + 1;
  }
  return null;
}

// ── 開始時間「時／分」雙選單（2026-09-30）──
export function hourChoices(startHour = 9, endHour = 21) {
  const list = [];
  for (let hour = startHour; hour <= endHour; hour += 1) list.push(hour);
  return list;
}

export function minuteChoices({ fifteenStep = false } = {}) {
  const step = fifteenStep ? 15 : 5;
  const list = [];
  for (let minute = 0; minute < 60; minute += step) list.push(String(minute).padStart(2, '0'));
  return list;
}

export function splitClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function composeClock(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
