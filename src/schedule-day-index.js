import { timeToMinute } from './schedule-booking-rules.js';

// Rebuild from the current day's normalized records on each render: no stale cache.
// Preserve Array.find's first-match behavior when stored bookings overlap.
// 覆蓋格數以「課程本身」（不含課後緩衝）計算：起點格向下取整、結束向上取整，
// 因此 11:05 起的課會佔用 11:00 那一格；緩衝尾巴不佔格，保留給下一堂課使用。
export function buildDayBookingIndex(bookings, totalSlots) {
  const ranges = bookings.map(booking => ({
    booking,
    space: Number(booking.space),
    start: timeToMinute(booking.time),
    duration: Number(booking.duration),
  })).filter(range => range.start != null && Number.isFinite(range.duration));
  const overlapping = new Set();
  for (let i = 0; i < ranges.length; i++) {
    const a = ranges[i];
    if (a.duration <= 0) continue;
    for (let j = i + 1; j < ranges.length; j++) {
      const b = ranges[j];
      if (a.space === b.space && b.duration > 0
        && a.start < b.start + b.duration && b.start < a.start + a.duration) {
        overlapping.add(a);
        overlapping.add(b);
      }
    }
  }
  const index = new Map();
  for (const range of ranges) {
    const { booking, space, start, duration } = range;
    const startSlot = Math.floor(start / 15);
    let endSlot = Math.ceil((start + duration) / 15);
    // Reserve a later start cell only for unambiguous, non-overlapping
    // records on BOTH sides. Otherwise retain legacy rounded coverage.
    if (!overlapping.has(range)) {
      for (const next of ranges) {
        if (next.space !== space || next.duration <= 0 || overlapping.has(next)) continue;
        if (next.start >= start + duration && next.start < endSlot * 15) {
          endSlot = Math.floor(next.start / 15);
        }
      }
    }
    if (!index.has(space)) index.set(space, new Array(totalSlots));
    const slots = index.get(space);
    for (let slot = Math.max(0, startSlot); slot < Math.min(totalSlots, endSlot); slot++) {
      if (slots[slot] === undefined) slots[slot] = booking;
    }
  }
  return index;
}
