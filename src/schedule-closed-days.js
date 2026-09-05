// Pure helpers for the boss-only rest-day (closed day) registry.
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizeClosedDayEntry(value) {
  if (!value || typeof value !== 'object') return true;
  const closedBy = typeof value.closedBy === 'string' ? value.closedBy.trim() : '';
  const createdAt = Number.isInteger(value.createdAt) ? value.createdAt : null;
  if (!closedBy && createdAt === null) return true;
  return { closedBy, createdAt };
}

export function normalizeClosedDays(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [rawKey, entry] of Object.entries(value)) {
    if (!DATE_KEY_PATTERN.test(rawKey) || DANGEROUS_KEYS.has(rawKey)) continue;
    result[rawKey] = normalizeClosedDayEntry(entry);
  }
  return result;
}

export function isClosedDay(closedDays, dateKey) {
  return !!closedDays && Object.hasOwn(closedDays, String(dateKey ?? ''));
}
