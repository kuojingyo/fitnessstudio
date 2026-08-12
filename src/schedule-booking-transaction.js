import { ADMIN_CAPACITY } from './admin-schedule-layout.js';

const ADMIN_SPACE = 1;
const OPEN_MINUTES = 9 * 60;
const SLOT_MINUTES = 15;

function bookingRange(booking) {
  if (!booking || Number(booking.space) !== ADMIN_SPACE) return null;
  const [hours, minutes] = String(booking.time || '').split(':').map(Number);
  const duration = Number(booking.duration);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)
    || !Number.isFinite(duration) || duration <= 0) return null;
  const start = (hours * 60 + minutes - OPEN_MINUTES) / SLOT_MINUTES;
  const end = start + duration / SLOT_MINUTES;
  return Number.isInteger(start) && Number.isInteger(end) && end > start
    ? { start, end }
    : null;
}

function exceedsAdminCapacity(dateNode) {
  const events = new Map();
  Object.values(dateNode || {}).forEach(booking => {
    const range = bookingRange(booking);
    if (!range) return;
    events.set(range.start, (events.get(range.start) || 0) + 1);
    events.set(range.end, (events.get(range.end) || 0) - 1);
  });
  let concurrent = 0;
  for (const slot of [...events.keys()].sort((a, b) => a - b)) {
    concurrent += events.get(slot);
    if (concurrent > ADMIN_CAPACITY) return true;
  }
  return false;
}

function normalizedMutation(mutation = {}) {
  return {
    removeIds: (mutation.removeIds || []).map(String),
    additions: mutation.additions || [],
    replacements: mutation.replacements || [],
  };
}

function setBooking(dateNode, booking) {
  const id = String(booking?.id || '').trim();
  if (!id) throw new Error('排課資料缺少 id，無法寫入 transaction。');
  dateNode[id] = { ...booking, id };
}

export function applyDateBookingMutation(currentValue, mutation) {
  const { removeIds, additions, replacements } = normalizedMutation(mutation);
  const removed = new Set(removeIds);
  const next = {};

  Object.entries(currentValue && typeof currentValue === 'object' ? currentValue : {})
    .forEach(([key, booking]) => {
      if (removed.has(String(key)) || removed.has(String(booking?.id))) return;
      next[key] = booking;
    });
  additions.forEach(booking => setBooking(next, booking));
  replacements.forEach(booking => setBooking(next, booking));

  const writesAdminBooking = [...additions, ...replacements]
    .some(booking => Number(booking?.space) === ADMIN_SPACE);
  if (writesAdminBooking && exceedsAdminCapacity(next)) {
    return { ok: false, value: currentValue ?? null, reason: 'admin-capacity' };
  }

  return {
    ok: true,
    value: Object.keys(next).length ? next : null,
    reason: null,
  };
}

export async function commitDateBookingMutation({ reference, mutation, runTransaction }) {
  let abortReason = null;
  const result = await runTransaction(reference, currentValue => {
    const next = applyDateBookingMutation(currentValue, mutation);
    abortReason = next.ok ? null : next.reason;
    return next.ok ? next.value : undefined;
  }, { applyLocally: false });

  return {
    committed: result.committed,
    reason: result.committed ? null : (abortReason || 'aborted'),
  };
}
