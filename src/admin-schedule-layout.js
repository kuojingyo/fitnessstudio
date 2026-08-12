export const ADMIN_CAPACITY = 3;

export function wouldExceedAdminCapacity(bookings, start, end, excludeIds = [], capacity = ADMIN_CAPACITY) {
  const excluded = new Set(excludeIds.map(String));
  const relevant = bookings.filter(booking => !excluded.has(String(booking.id)));

  for (let slot = start; slot < end; slot += 1) {
    const concurrent = relevant.filter(booking => booking.start < slot + 1 && booking.end > slot).length;
    if (concurrent >= capacity) return true;
  }
  return false;
}

export function buildAdminSegments(bookings) {
  const normalized = bookings
    .filter(booking => Number.isFinite(booking.start) && Number.isFinite(booking.end) && booking.end > booking.start)
    .map((booking, order) => ({ ...booking, order }))
    .sort((a, b) => a.start - b.start || a.order - b.order);
  const boundaries = [...new Set(normalized.flatMap(booking => [booking.start, booking.end]))].sort((a, b) => a - b);
  const segments = [];

  for (let boundary = 0; boundary < boundaries.length - 1; boundary += 1) {
    const start = boundaries[boundary];
    const end = boundaries[boundary + 1];
    const active = normalized.filter(booking => booking.start < end && booking.end > start);
    active.forEach((booking, index) => {
      segments.push({
        ...booking,
        start,
        end,
        count: active.length,
        index,
        continuesBefore: start > booking.start,
        continuesAfter: end < booking.end,
      });
    });
  }

  return segments;
}

export function buildAdminSlotStates(bookings, totalSlots, capacity = ADMIN_CAPACITY) {
  return Array.from({ length: totalSlots }, (_, slot) => {
    const count = bookings.filter(booking => booking.start < slot + 1 && booking.end > slot).length;
    return { slot, count, canAdd: count < capacity };
  });
}
