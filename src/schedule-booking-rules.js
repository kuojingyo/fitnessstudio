export const COACH_DURATIONS = [75, 90];
export const DEFAULT_COACH_DURATION = 75;
export const MIN_ADMIN_DURATION = 30;
export const MAX_ADMIN_DURATION = 240;
const SLOT_MINUTES = 15;
// 允許寫入的教練課與團課時長：75／90 為現行可選項；60 僅為讓既有資料仍可寫入而保留，UI 不提供 60 選項
export const ALLOWED_COACH_DURATIONS = [60, 75, 90];

export function isAllowedCoachDuration(value) {
  return typeof value === 'number' && ALLOWED_COACH_DURATIONS.includes(value);
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

// 排課視窗的時長選項：一律只有現行可選時長，不再顯示舊時長
export function coachDurationOptions() {
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

export function resolveDropSlot({ clientY, firstTop, lastBottom, rowHeight, slotCount = 52 } = {}) {
  if (![clientY, firstTop, lastBottom, rowHeight].every(Number.isFinite)) return null;
  if (rowHeight <= 0 || !(slotCount > 0)) return null;
  if (clientY < firstTop || clientY > lastBottom) return null;
  const slot = Math.floor((clientY - firstTop) / rowHeight);
  if (!Number.isFinite(slot)) return null;
  return Math.max(0, Math.min(slotCount - 1, slot));
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
