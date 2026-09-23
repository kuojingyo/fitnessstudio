export const COACH_DURATIONS = [75, 90];
export const DEFAULT_COACH_DURATION = 75;
export const LEGACY_COACH_DURATIONS = [60];
export const MIN_ADMIN_DURATION = 30;
export const MAX_ADMIN_DURATION = 240;
const SLOT_MINUTES = 15;
// 允許寫入的教練課與團課時長：75／90 為現行可選項，60 只為既有資料保留（不可再被選擇）
export const ALLOWED_COACH_DURATIONS = [60, 75, 90];

export function isAllowedCoachDuration(value) {
  return typeof value === 'number' && ALLOWED_COACH_DURATIONS.includes(value);
}

// 舊時長（已取消選項）：只在編輯既有資料時以原時長顯示，不可被重新選擇
export function isLegacyCoachDuration(value) {
  return LEGACY_COACH_DURATIONS.includes(Number(value));
}

// 前端載入正規化與表單驗證共用：行政時段限制 30–240 分鐘，教練課與團課僅允許白名單時長
export function isAllowedBookingDuration(space, duration, { adminSpace = 1 } = {}) {
  if (Number(space) === adminSpace) {
    return typeof duration === 'number'
      && duration >= MIN_ADMIN_DURATION
      && duration <= MAX_ADMIN_DURATION
      && duration % SLOT_MINUTES === 0;
  }
  return isAllowedCoachDuration(duration);
}

export function coachDurationOptions({ editing = false, duration } = {}) {
  if (editing && LEGACY_COACH_DURATIONS.includes(Number(duration))) {
    return [...COACH_DURATIONS, Number(duration)];
  }
  return [...COACH_DURATIONS];
}

export function isBookingStartInDayRange(time, { openMinutes = 9 * 60, closeMinutes = 22 * 60, slotMinutes = 15 } = {}) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time));
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const total = hours * 60 + minutes;
  return minutes < 60 && total >= openMinutes && total < closeMinutes && total % slotMinutes === 0;
}

// 09:00 起算的第 60 格（每格 15 分鐘）＝ 24:00，晚間排課最晚只能到午夜，不可跨到隔天。
export const NIGHT_LIMIT_SLOT = 60;

export function isBookingEndWithinNightLimit(slot, duration, { lastSlot = NIGHT_LIMIT_SLOT, slotMinutes = 15 } = {}) {
  const slots = Number(duration) / slotMinutes;
  return Number.isInteger(slot) && slot >= 0
    && Number.isFinite(slots) && slots > 0
    && slot + slots <= lastSlot;
}

export function dayBookingRowspan(time, duration, totalSlots, { openMinutes = 9 * 60, slotMinutes = 15 } = {}) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time));
  const start = match ? (Number(match[1]) * 60 + Number(match[2]) - openMinutes) / slotMinutes : NaN;
  const slots = Number(duration) / slotMinutes;
  if (!Number.isFinite(start) || !Number.isFinite(slots)) return 0;
  return Math.max(0, Math.min(Number(totalSlots) - start, slots));
}
