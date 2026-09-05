// Rebuild from the current day's normalized records on each render: no stale cache.
// Preserve Array.find's first-match behavior when stored bookings overlap.
export function buildDayBookingIndex(bookings, totalSlots) {
  const index = new Map();
  for (const booking of bookings) {
    const space = Number(booking.space);
    const [hours, minutes] = String(booking.time).split(':').map(Number);
    const start = (hours * 60 + minutes - 9 * 60) / 15;
    const end = start + Number(booking.duration) / 15;
    if (!index.has(space)) index.set(space, new Array(totalSlots));
    const slots = index.get(space);
    for (let slot = Math.max(0, Math.ceil(start)); slot < Math.min(totalSlots, end); slot++) {
      if (slots[slot] === undefined) slots[slot] = booking;
    }
  }
  return index;
}
