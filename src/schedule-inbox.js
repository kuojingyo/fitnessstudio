const INBOX_KINDS = new Set(['admin', 'coach', 'team', 'overlap']);
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function isValidTime(value) {
  const match = TIME_PATTERN.exec(String(value ?? ''));
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function isSafeInboxId(value) {
  const id = String(value ?? '').trim();
  return !!id && !DANGEROUS_KEYS.has(id);
}

export function buildInboxMessage({
  id, to, from, kind, date, time, duration, space, remark, createdAt = Date.now(),
}) {
  if (!isSafeInboxId(id)) return null;
  if (typeof to !== 'string' || !to.trim()) return null;
  if (typeof from !== 'string' || !from.trim()) return null;
  if (!INBOX_KINDS.has(kind)) return null;
  if (!DATE_PATTERN.test(String(date ?? ''))) return null;
  if (!isValidTime(time)) return null;
  if (!Number.isInteger(duration) || duration <= 0) return null;
  if (!Number.isInteger(space) || space < 1 || space > 9) return null;
  if (!Number.isInteger(createdAt)) return null;
  const message = {
    id: String(id), to, from, kind, date, time, duration, space,
    read: false, createdAt,
  };
  if (typeof remark === 'string' && remark.trim()) {
    const trimmed = remark.trim();
    if (trimmed.length > 200) return null;
    message.remark = trimmed;
  }
  return message;
}

export function normalizeInbox(data) {
  const result = {};
  if (!data || typeof data !== 'object') return result;
  for (const [user, rawMessages] of Object.entries(data)) {
    if (DANGEROUS_KEYS.has(user)) continue;
    if (!rawMessages || typeof rawMessages !== 'object') continue;
    const entries = Array.isArray(rawMessages)
      ? rawMessages.map(item => [item?.id, item])
      : Object.entries(rawMessages);
    const messages = {};
    for (const [rawKey, raw] of entries) {
      const message = buildInboxMessage({
        ...(raw && typeof raw === 'object' ? raw : {}),
        id: String(raw?.id ?? rawKey ?? '').trim(),
        createdAt: raw?.createdAt ?? Date.now(),
      });
      if (!message || messages[message.id]) continue;
      messages[message.id] = message;
    }
    if (Object.keys(messages).length) result[user] = messages;
  }
  return result;
}

export function unreadCount(messages) {
  const list = messages == null ? [] : (Array.isArray(messages) ? messages : Object.values(messages));
  return list.filter(message => message && message.read !== true).length;
}

export function withMessageRead(messages, id) {
  const list = messages == null ? {} : messages;
  if (Array.isArray(list)) {
    if (!list.some(message => message?.id === id)) return list;
    return list.map(message => (message?.id === id ? { ...message, read: true } : message));
  }
  const target = list[id];
  if (!target || target.read === true) return list;
  return { ...list, [id]: { ...target, read: true } };
}

export function withAllRead(messages) {
  if (messages == null) return messages;
  if (Array.isArray(messages)) {
    return messages.map(message => (message ? { ...message, read: true } : message));
  }
  return Object.fromEntries(Object.entries(messages).map(([id, message]) => [id, { ...message, read: true }]));
}
