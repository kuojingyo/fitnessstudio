import { timeToMinute } from './schedule-booking-rules.js';

// Rebuild from the current day's normalized records on each render: no stale cache.
// Preserve Array.find's first-match behavior when stored bookings overlap.
// 覆蓋格數以「課程本身」（不含課後緩衝）計算：起點格向下取整、結束向上取整，
// 因此 11:05 起的課會佔用 11:00 那一格；緩衝尾巴不佔格，保留給下一堂課使用。
export function buildDayBookingIndex(bookings, totalSlots) {
  const index = new Map();
  for (const booking of bookings) {
    const space = Number(booking.space);
    const start = timeToMinute(booking.time);
    if (start == null) continue;
    const duration = Number(booking.duration);
    if (!Number.isFinite(duration)) continue;
    const startSlot = Math.floor(start / 15);
    const endSlot = Math.ceil((start + duration) / 15);
    if (!index.has(space)) index.set(space, new Array(totalSlots));
    const slots = index.get(space);
    for (let slot = Math.max(0, startSlot); slot < Math.min(totalSlots, endSlot); slot++) {
      if (slots[slot] === undefined) slots[slot] = booking;
    }
  }
  return index;
}
