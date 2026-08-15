import { ADMIN_CAPACITY } from './admin-schedule-layout.js';

const ADMIN_SPACE = 1;
const OTHER_OWNER = '其他';
const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 22 * 60;
const SLOT_MINUTES = 15;
const MIN_ADMIN_DURATION = 30;
const MAX_ADMIN_DURATION = 240;
const MAX_SPACE = 9;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const DANGEROUS_CHILD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const PATCH_EXPECTED_FIELDS = ['time', 'duration', 'space', 'owner', 'kind'];
const TEAM_SPACES = [7, 8, 9];
const SCHEDULABLE_OWNERS = new Set(['史昕銓', '高芷妍', '潘閱滔', OTHER_OWNER]);

export function bookingMutationErrorMessage(reason) {
  if (reason === 'admin-capacity') return `⚠️ 行政時段同一時間最多安排 ${ADMIN_CAPACITY} 位教練。`;
  if (reason === 'owner-conflict') return '⚠️ 此操作會與同一位教練的其他排課重疊。';
  if (reason === 'space-conflict') return '⚠️ 該場地在這個時段已有其他排課，請重新選擇。';
  if (reason === 'booking-missing') return '⚠️ 這筆排課已被刪除，畫面將重新同步。';
  if (reason === 'booking-changed') return '⚠️ 這筆排課已被其他裝置修改，請依最新內容再操作。';
  if (reason === 'booking-exists') return '⚠️ 新排課識別碼發生衝突，請再送出一次。';
  if (reason === 'group-changed') return '⚠️ 團課成員已被其他裝置變更，請確認最新內容後再試。';
  if (reason === 'invalid-group') return '⚠️ 團課資料不完整，已停止寫入以避免留下殘缺排課。';
  if (reason === 'invalid-booking-data') return '⚠️ 排課資料格式異常，已停止寫入並保留原資料。';
  if (reason === 'invalid-mutation') return '⚠️ 排課操作資料不完整，請重新整理後再試。';
  if (reason === 'admin-range') return '⚠️ 行政時間超出可排範圍，請重新調整。';
  return '⚠️ 排課資料已變更，請確認最新內容後再試。';
}

function isSafeBookingId(value) {
  const id = String(value ?? '').trim();
  return !!id && !DANGEROUS_CHILD_KEYS.has(id);
}

export function bookingSpaceNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[1-9]$/.test(normalized) ? Number(normalized) : null;
}

export function bookingDurationNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[1-9][0-9]*$/.test(normalized) ? Number(normalized) : null;
}

function normalizeCurrentDateNode(currentValue) {
  if (currentValue == null) return { ok: true, value: {} };
  if (typeof currentValue !== 'object') return { ok: false };
  const prototype = Object.getPrototypeOf(currentValue);
  if (!Array.isArray(currentValue) && prototype !== Object.prototype && prototype !== null) {
    return { ok: false };
  }

  const fromLegacyArray = Array.isArray(currentValue);
  const normalized = {};
  for (const [rawKey, booking] of Object.entries(currentValue)) {
    if (!booking || typeof booking !== 'object' || Array.isArray(booking)) return { ok: false };
    const key = String(rawKey).trim();
    const id = String(booking.id ?? key).trim();
    if (!isSafeBookingId(key) || !isSafeBookingId(id)) return { ok: false };
    if (!fromLegacyArray && key !== id) return { ok: false };
    if (Object.hasOwn(normalized, id)) return { ok: false };
    normalized[id] = { ...booking, id };
  }
  return { ok: true, value: normalized };
}

function bookingRangeMinutes(booking) {
  if (!booking) return null;
  const match = TIME_PATTERN.exec(String(booking.time || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const duration = bookingDurationNumber(booking.duration);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)
    || hours < 0 || hours > 23 || minutes < 0 || minutes > 59
    || !Number.isInteger(duration) || duration <= 0) return null;
  const start = hours * 60 + minutes;
  const end = start + duration;
  return end > start ? { start, end } : null;
}

function adminBookingRange(booking) {
  if (bookingSpaceNumber(booking?.space) !== ADMIN_SPACE) return null;
  const range = bookingRangeMinutes(booking);
  if (!range) return null;
  const start = (range.start - OPEN_MINUTES) / SLOT_MINUTES;
  const end = (range.end - OPEN_MINUTES) / SLOT_MINUTES;
  return Number.isInteger(start) && Number.isInteger(end) ? { start, end } : null;
}

function hasValidAdminRange(booking) {
  if (bookingSpaceNumber(booking?.space) !== ADMIN_SPACE) return true;
  const range = bookingRangeMinutes(booking);
  const duration = bookingDurationNumber(booking?.duration);
  return !!range
    && range.start >= OPEN_MINUTES
    && range.end <= CLOSE_MINUTES
    && duration >= MIN_ADMIN_DURATION
    && duration <= MAX_ADMIN_DURATION
    && duration % SLOT_MINUTES === 0
    && range.start % SLOT_MINUTES === 0;
}

function hasValidBookingRange(booking) {
  const space = bookingSpaceNumber(booking?.space);
  if (!Number.isInteger(space) || space < ADMIN_SPACE || space > MAX_SPACE) return false;
  if (space === ADMIN_SPACE) return hasValidAdminRange(booking);
  const range = bookingRangeMinutes(booking);
  const duration = bookingDurationNumber(booking?.duration);
  return !!range
    && range.start >= OPEN_MINUTES
    && range.end <= CLOSE_MINUTES
    && range.start % SLOT_MINUTES === 0
    && duration % SLOT_MINUTES === 0;
}

function hasConsistentBookingIds(dateNode) {
  return Object.entries(dateNode || {}).every(([key, booking]) => (
    booking?.id != null && String(key) === String(booking.id)
  ));
}

function exceedsAdminCapacity(dateNode) {
  const events = new Map();
  Object.values(dateNode || {}).forEach(booking => {
    const range = adminBookingRange(booking);
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
    patches: mutation.patches || [],
    expectedRecords: mutation.expectedRecords || [],
    expectedGroups: mutation.expectedGroups || [],
  };
}

function setBooking(dateNode, booking) {
  const id = String(booking?.id || '').trim();
  if (!id) throw new Error('排課資料缺少 id，無法寫入 transaction。');
  dateNode[id] = { ...booking, id };
}

function mergeBookingReplacement(currentBooking, replacement) {
  const merged = { ...currentBooking, ...replacement };
  ['nickname', 'remark', 'groupId'].forEach(field => {
    if (!Object.hasOwn(replacement, field)) delete merged[field];
  });
  return merged;
}

function findBookingEntry(dateNode, id) {
  return Object.entries(dateNode).find(([key, booking]) => (
    String(key) === id || String(booking?.id) === id
  )) || null;
}

function normalizedOwner(owner) {
  const value = typeof owner === 'string' ? owner.trim() : owner;
  return value === 'admin' ? '老闆' : value;
}

export function isSchedulableBookingOwner(owner) {
  return SCHEDULABLE_OWNERS.has(normalizedOwner(owner));
}

export function bookingOwnerIdentity(booking) {
  const owner = normalizedOwner(booking?.owner);
  if (typeof owner !== 'string' || !owner) return '';
  if (owner !== OTHER_OWNER) return `owner:${owner}`;
  const nickname = String(booking?.nickname ?? '').trim();
  return nickname ? `other:${nickname}` : '';
}

function normalizedKind(booking) {
  return ['admin', 'coach', 'team'].includes(booking?.kind)
    ? booking.kind
    : (Number(booking?.space) === ADMIN_SPACE ? 'admin' : 'coach');
}

function hasExpectedValues(booking, expected = {}) {
  return Object.entries(expected).every(([key, value]) => {
    if (key === 'owner') return normalizedOwner(booking?.[key]) === normalizedOwner(value);
    if (key === 'space' || key === 'duration') return Number(booking?.[key]) === Number(value);
    if (key === 'time') return String(booking?.[key] ?? '').trim() === String(value ?? '').trim();
    if (key === 'kind') {
      return normalizedKind(booking) === normalizedKind({
        ...booking,
        ...(expected.space == null ? {} : { space: expected.space }),
        kind: value,
      });
    }
    return booking?.[key] === value;
  });
}

export function bookingMutationExpectedValues(booking) {
  return {
    space: booking?.space,
    owner: booking?.owner,
    kind: booking?.kind,
    time: booking?.time,
    duration: booking?.duration,
    nickname: booking?.nickname,
    remark: booking?.remark,
    groupId: booking?.groupId,
    createdAt: booking?.createdAt,
  };
}

export function buildDateBookingMutation({
  mode, originalRecords = [], records = [], requiredTeamSpaces = TEAM_SPACES,
}) {
  if (mode === 'create') {
    return {
      removeIds: [],
      additions: records,
      replacements: [],
      expectedRecords: [],
      expectedGroups: [],
    };
  }
  if (mode !== 'edit' && mode !== 'delete') throw new Error(`不支援的排課 mutation 模式：${mode}`);
  const nextRecords = mode === 'delete' ? [] : records;
  const originalById = new Map(originalRecords.map(booking => [String(booking.id), booking]));
  const resultIds = new Set(nextRecords.map(booking => String(booking.id)));
  const groupIds = [...new Set(originalRecords
    .filter(booking => normalizedKind(booking) === 'team')
    .map(booking => String(booking.groupId ?? '').trim()))];
  return {
    removeIds: originalRecords
      .filter(booking => !resultIds.has(String(booking.id)))
      .map(booking => String(booking.id)),
    additions: nextRecords.filter(booking => !originalById.has(String(booking.id))),
    replacements: nextRecords.filter(booking => originalById.has(String(booking.id))),
    expectedRecords: originalRecords.map(booking => ({
      id: String(booking.id),
      expected: bookingMutationExpectedValues(booking),
    })),
    expectedGroups: groupIds.map(groupId => ({
      groupId,
      memberIds: originalRecords
        .filter(booking => String(booking.groupId ?? '').trim() === groupId)
        .map(booking => String(booking.id)),
      requiredSpaces: [...requiredTeamSpaces],
    })),
  };
}

export function buildAdminBookingPaste({ source, targetDate, id, createdAt = Date.now() }) {
  const destinationDate = String(targetDate ?? '').trim();
  const sourceOwner = normalizedOwner(source?.owner);
  const sourceNickname = String(source?.nickname ?? '').trim();
  if (!source
    || !isSafeBookingId(id)
    || !/^\d{4}-\d{2}-\d{2}$/.test(destinationDate)
    || typeof sourceOwner !== 'string'
    || !sourceOwner.trim()
    || !isSchedulableBookingOwner(sourceOwner)
    || (sourceOwner === OTHER_OWNER && !sourceNickname)
    || bookingSpaceNumber(source.space) !== ADMIN_SPACE
    || normalizedKind(source) !== 'admin'
    || String(source.date ?? '').trim() === destinationDate) return null;
  const booking = {
    id: String(id),
    date: destinationDate,
    space: ADMIN_SPACE,
    owner: sourceOwner.trim(),
    kind: 'admin',
    time: String(source.time).trim(),
    duration: Number(source.duration),
    createdAt,
  };
  if (sourceNickname) booking.nickname = sourceNickname;
  if (source.remark) booking.remark = String(source.remark);
  return {
    booking,
    mutation: buildDateBookingMutation({ mode: 'create', records: [booking] }),
  };
}

function ownerHasConflict(dateNode, targetKey) {
  const target = dateNode[targetKey];
  const targetOwnerIdentity = bookingOwnerIdentity(target);
  if (!target || !targetOwnerIdentity) return false;
  const targetRange = bookingRangeMinutes(target);
  if (!targetRange) return false;
  return Object.entries(dateNode).some(([key, booking]) => {
    if (key === targetKey || !booking || bookingOwnerIdentity(booking) !== targetOwnerIdentity) return false;
    const sameTeamGroup = normalizedKind(target) === 'team'
      && normalizedKind(booking) === 'team'
      && target.groupId
      && String(target.groupId) === String(booking.groupId);
    if (sameTeamGroup) return false;
    const range = bookingRangeMinutes(booking);
    return range ? targetRange.start < range.end && targetRange.end > range.start : false;
  });
}

function spaceHasConflict(dateNode, targetKey) {
  const target = dateNode[targetKey];
  const targetSpace = Number(target?.space);
  if (!target || targetSpace === ADMIN_SPACE) return false;
  const targetRange = bookingRangeMinutes(target);
  if (!targetRange) return false;
  return Object.entries(dateNode).some(([key, booking]) => {
    if (key === targetKey || !booking || Number(booking.space) !== targetSpace) return false;
    const range = bookingRangeMinutes(booking);
    return range ? targetRange.start < range.end && targetRange.end > range.start : false;
  });
}

function hasValidTeamGroup(groupId, members) {
  if (!isSafeBookingId(groupId)) return false;
  const spaces = members.map(member => Number(member.space)).sort((a, b) => a - b);
  if (spaces.length !== TEAM_SPACES.length
    || spaces.some((space, index) => space !== TEAM_SPACES[index])) return false;
  const first = members[0];
  return members.every(member => (
    normalizedKind(member) === 'team'
    && String(member.groupId ?? '').trim() === groupId
    && String(member.date ?? '') === String(first.date ?? '')
    && normalizedOwner(member.owner) === normalizedOwner(first.owner)
    && String(member.time ?? '').trim() === String(first.time ?? '').trim()
    && Number(member.duration) === Number(first.duration)
  ));
}

function hasValidTeamGroups(dateNode) {
  const groups = new Map();
  for (const booking of Object.values(dateNode)) {
    if (normalizedKind(booking) !== 'team') continue;
    const groupId = String(booking?.groupId ?? '').trim();
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(booking);
  }
  return [...groups.entries()].every(([groupId, members]) => hasValidTeamGroup(groupId, members));
}

function validateExpectedGroups(dateNode, expectedGroups) {
  const validatedGroupIds = new Set();
  for (const expectedGroup of expectedGroups) {
    const groupId = String(expectedGroup?.groupId ?? '').trim();
    const memberIds = expectedGroup?.memberIds;
    const requiredSpaces = expectedGroup?.requiredSpaces;
    if (!isSafeBookingId(groupId) || !Array.isArray(memberIds) || !Array.isArray(requiredSpaces)
      || new Set(memberIds.map(String)).size !== memberIds.length
      || memberIds.some(id => !isSafeBookingId(id))
      || requiredSpaces.length !== TEAM_SPACES.length
      || [...requiredSpaces].map(Number).sort((a, b) => a - b)
        .some((space, index) => space !== TEAM_SPACES[index])) {
      return { ok: false, reason: 'invalid-mutation' };
    }
    const remoteMembers = Object.values(dateNode)
      .filter(booking => String(booking?.groupId ?? '').trim() === groupId);
    const remoteIds = remoteMembers.map(booking => String(booking.id)).sort();
    const expectedIds = memberIds.map(String).sort();
    const remoteSpaces = remoteMembers.map(booking => Number(booking.space)).sort((a, b) => a - b);
    if (remoteIds.length !== expectedIds.length
      || remoteIds.some((id, index) => id !== expectedIds[index])
      || remoteSpaces.length !== TEAM_SPACES.length
      || remoteSpaces.some((space, index) => space !== TEAM_SPACES[index])) {
      return { ok: false, reason: 'group-changed' };
    }
    if (!hasValidTeamGroup(groupId, remoteMembers)) {
      return { ok: false, reason: 'invalid-group' };
    }
    validatedGroupIds.add(groupId);
  }
  return { ok: true, groupIds: validatedGroupIds };
}

export function applyDateBookingMutation(currentValue, mutation) {
  const {
    removeIds, additions, replacements, patches, expectedRecords, expectedGroups,
  } = normalizedMutation(mutation);
  const normalizedCurrent = normalizeCurrentDateNode(currentValue);
  if (!normalizedCurrent.ok) {
    return { ok: false, value: currentValue, reason: 'invalid-booking-data' };
  }
  const current = normalizedCurrent.value;
  const expectedEntries = new Map();
  const groupValidation = validateExpectedGroups(current, expectedGroups);
  if (!groupValidation.ok) {
    return { ok: false, value: currentValue ?? null, reason: groupValidation.reason };
  }

  for (const record of expectedRecords) {
    const id = String(record?.id || '').trim();
    const entry = id ? findBookingEntry(current, id) : null;
    if (!entry) return { ok: false, value: currentValue ?? null, reason: 'booking-missing' };
    const [key, booking] = entry;
    if (String(key) !== id || booking?.id == null || String(booking.id) !== id
      || !hasExpectedValues(booking, record.expected)) {
      return { ok: false, value: currentValue ?? null, reason: 'booking-changed' };
    }
    expectedEntries.set(id, booking);
  }

  if ([...expectedEntries.values()].some(booking => (
    normalizedKind(booking) === 'team'
    && !groupValidation.groupIds.has(String(booking.groupId ?? '').trim())
  ))) {
    return { ok: false, value: currentValue ?? null, reason: 'invalid-mutation' };
  }

  if (removeIds.some(id => !expectedEntries.has(String(id).trim()))) {
    return { ok: false, value: currentValue ?? null, reason: 'invalid-mutation' };
  }

  const removed = new Set(removeIds);
  const next = {};

  Object.entries(current)
    .forEach(([key, booking]) => {
      if (removed.has(String(key)) || removed.has(String(booking?.id))) return;
      next[key] = booking;
    });
  const writtenKeys = [];
  for (const booking of additions) {
    const id = String(booking?.id ?? '').trim();
    if (!isSafeBookingId(id)) {
      return { ok: false, value: currentValue ?? null, reason: 'invalid-booking-data' };
    }
    if (Object.hasOwn(current, id) || Object.hasOwn(next, id)) {
      return { ok: false, value: currentValue ?? null, reason: 'booking-exists' };
    }
    setBooking(next, booking);
    writtenKeys.push(id);
  }
  for (const booking of replacements) {
    const id = String(booking?.id || '').trim();
    const currentBooking = expectedEntries.get(id);
    if (!currentBooking) {
      return { ok: false, value: currentValue ?? null, reason: 'invalid-mutation' };
    }
    setBooking(next, mergeBookingReplacement(currentBooking, booking));
    writtenKeys.push(id);
  }

  const patchedKeys = [];
  for (const patch of patches) {
    const id = String(patch?.id || '').trim();
    if (!patch?.expected || PATCH_EXPECTED_FIELDS.some(field => !Object.hasOwn(patch.expected, field))) {
      return { ok: false, value: currentValue ?? null, reason: 'invalid-mutation' };
    }
    const entry = findBookingEntry(next, id);
    if (!entry) return { ok: false, value: currentValue ?? null, reason: 'booking-missing' };
    const [key, booking] = entry;
    if (normalizedKind(booking) === 'team'
      && !groupValidation.groupIds.has(String(booking.groupId ?? '').trim())) {
      return { ok: false, value: currentValue ?? null, reason: 'invalid-mutation' };
    }
    if (String(key) === id && booking?.id != null && String(booking.id) !== id) {
      return { ok: false, value: currentValue ?? null, reason: 'booking-changed' };
    }
    if (!hasExpectedValues(booking, patch.expected)) {
      return { ok: false, value: currentValue ?? null, reason: 'booking-changed' };
    }
    next[key] = { ...booking, ...(patch.changes || {}), id: String(booking.id || id) };
    if (!hasValidAdminRange(next[key])) {
      return { ok: false, value: currentValue ?? null, reason: 'admin-range' };
    }
    patchedKeys.push(key);
  }

  const writesAdminBooking = [...additions, ...replacements, ...patchedKeys.map(key => next[key])]
    .some(booking => Number(booking?.space) === ADMIN_SPACE);
  const affectedAdminBookings = [...additions, ...replacements, ...patchedKeys.map(key => next[key])]
    .filter(booking => Number(booking?.space) === ADMIN_SPACE);
  if (affectedAdminBookings.some(booking => !hasValidAdminRange(booking))) {
    return { ok: false, value: currentValue ?? null, reason: 'admin-range' };
  }
  if (writesAdminBooking && exceedsAdminCapacity(next)) {
    return { ok: false, value: currentValue ?? null, reason: 'admin-capacity' };
  }
  const hasWrites = additions.length > 0 || replacements.length > 0 || patches.length > 0;
  if (hasWrites && (!hasConsistentBookingIds(next)
    || Object.values(next).some(booking => !hasValidBookingRange(booking)))) {
    return { ok: false, value: currentValue ?? null, reason: 'invalid-booking-data' };
  }
  if (!hasValidTeamGroups(next)) {
    return { ok: false, value: currentValue ?? null, reason: 'invalid-group' };
  }
  const affectedKeys = [...new Set([...writtenKeys, ...patchedKeys])];
  if (affectedKeys.some(key => spaceHasConflict(next, key))) {
    return { ok: false, value: currentValue ?? null, reason: 'space-conflict' };
  }
  if (affectedKeys.some(key => ownerHasConflict(next, key))) {
    return { ok: false, value: currentValue ?? null, reason: 'owner-conflict' };
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