import './schedule-redesign.css';
import { ADMIN_CAPACITY, buildAdminSegments, buildAdminSlotStates, wouldExceedAdminCapacity } from './admin-schedule-layout.js';
import {
  ADMIN_DURATIONS,
  keyboardAdminResizeCommand,
  pointerYToAdminSlot,
  resizeAdminRange,
} from './admin-schedule-resize.js';
import {
  applyDateBookingMutation,
  bookingOwnerIdentity,
  bookingSpaceNumber,
  bookingDurationNumber,
  bookingMutationErrorMessage,
  canModifyPastBooking,
  buildAdminBookingPaste,
  buildDateBookingMutation,
  buildPublishDraftMutation,
  commitDateBookingMutation,
  isAdminTeachingOverlapPair,
  bookingKindForOverlap,
  isSchedulableBookingOwner,
} from './schedule-booking-transaction.js';
import { createIdleTimeout, IDLE_TIMEOUT_MS } from './schedule-idle-timeout.js';
import {
  buildInboxMessage, normalizeInbox, unreadCount, withAllRead, withMessageRead,
  withoutMessage, withoutReadMessages,
} from './schedule-inbox.js';

const ROOT_PATH = 'scheduleV2Bookings';
const FALLBACK_KEY = 'relife_schedule_v2_bookings';
const SESSION_KEY = 'relife_schedule_user';
const INBOX_ROOT = 'scheduleV2Inbox';
const INBOX_FALLBACK_KEY = 'relife_schedule_v2_inbox';
const PASSWORDS = { '老闆': '1564', '史昕銓': '1226', '高芷妍': 'kari812615', '潘閱滔': 'e3828736' };
const USERS = {
  '老闆': { name: '老闆', role: 'admin' },
  '史昕銓': { name: '史昕銓', role: 'admin' },
  '高芷妍': { name: '高芷妍', role: 'user' },
  '潘閱滔': { name: '潘閱滔', role: 'user' }
};
const OTHER_OWNER = '其他';
const SCHEDULABLE_USERS = ['史昕銓', '高芷妍', '潘閱滔'];
const TEAM_SPACES = [7, 8, 9];
const SPACES = 9;
const SPACE_NAMES = ['行政時段', '一樓槓座', '一樓史密斯', '一樓cable', '一樓機動空間', '二樓槓座', '二樓自由重量(1)', '二樓自由重量(2)', '二樓機動空間'];
const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;
const SLOT_MINUTES = 15;
const SLOTS_PER_DAY = (CLOSE_HOUR - OPEN_HOUR) * 60 / SLOT_MINUTES;
const COACH_DURATIONS = [75, 90];
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:09|1\d|2[01]):(?:00|15|30|45)$/;
const FORCE_LOCAL_DEMO = import.meta.env.DEV && new URLSearchParams(window.location.search).get('demo') === '1';

let db = null;
let firebaseApi = null;
let useFallback = false;
let dataStatus = 'loading';
let dataErrorMessage = '';
let rawBookings = {};
let inboxByUser = {};
let currentUser = null;
let idleTimeout = null;
let currentDate = new Date();
let currentView = 'month';
let selectedDateKey = null;
let modalState = null;
let lastModalTrigger = null;
let toastTimer = null;
let mutationInProgress = false;
let adminResizeState = null;
let adminBookingClipboard = null;

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function parseDate(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
function formatDateCN(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}）`; }
function timeToSlot(value) { const [h, m] = String(value).split(':').map(Number); return (h * 60 + m - OPEN_HOUR * 60) / SLOT_MINUTES; }
function slotToTime(slot) { const total = OPEN_HOUR * 60 + slot * SLOT_MINUTES; return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`; }
function durationToSlots(duration) { return Number(duration) / SLOT_MINUTES; }
function endTime(start, duration) {
  const startSlot = timeToSlot(start);
  const durationSlots = durationToSlots(duration);
  if (!Number.isFinite(startSlot) || !Number.isFinite(durationSlots)) return '';
  return slotToTime(startSlot + durationSlots);
}
function spaceName(space) { return SPACE_NAMES[Number(space) - 1] || `空間 ${space}`; }
function isAdminSpace(space) { return Number(space) === 1; }
function isTeamSpace(space) { return TEAM_SPACES.includes(Number(space)); }
function ownerLabel(booking) { return booking.owner === OTHER_OWNER ? (booking.nickname || OTHER_OWNER) : (booking.owner || '未指定'); }
function ownerColorClass(owner) {
  if (owner === '高芷妍') return 'high';
  if (owner === '潘閱滔') return 'pan';
  return '';
}
function courseLabel(booking) { return booking.kind === 'team' ? '團課' : (booking.space === 1 ? '行政' : '教練課'); }
function isToday(date) { const now = new Date(); return fmtDate(now) === fmtDate(date); }
function isAdmin() { return currentUser?.role === 'admin'; }
function isBossManager() { return currentUser?.name === '老闆'; }
function isLoggedIn() { return !!currentUser; }
function isDataReady() { return dataStatus === 'ready'; }

function normalizeBookings(value) {
  const result = {};
  let ignoredCount = 0;
  for (const [date, data] of Object.entries(value || {})) {
    if (!DATE_KEY_PATTERN.test(date) || (!Array.isArray(data) && (!data || typeof data !== 'object'))) {
      ignoredCount++;
      continue;
    }
    const entries = Array.isArray(data)
      ? data.map((item, index) => [item?.id ?? String(index), item])
      : Object.entries(data);
    const bookings = [];
    for (const [recordId, item] of entries) {
      if (!item || typeof item !== 'object') { ignoredCount++; continue; }
      const id = String(item.id ?? recordId ?? '').trim();
      const space = bookingSpaceNumber(item.space);
      const duration = bookingDurationNumber(item.duration);
      const storedOwner = typeof item.owner === 'string' ? item.owner.trim() : '';
      const owner = storedOwner === 'admin' ? '老闆' : storedOwner;
      const time = typeof item.time === 'string' ? item.time.trim() : '';
      const kind = ['admin', 'coach', 'team'].includes(item.kind) ? item.kind : (space === 1 ? 'admin' : 'coach');
      const slot = timeToSlot(time);
      const valid = id
        && Number.isInteger(space) && space >= 1 && space <= SPACES
        && owner
        && TIME_PATTERN.test(time)
        && Number.isFinite(duration) && duration > 0 && duration % SLOT_MINUTES === 0
        && Number.isInteger(slot) && validateRange(slot, duration)
        && (kind !== 'team' || isTeamSpace(space))
        && (item.draft === undefined || (item.draft === true && space === 1 && kind === 'admin'));
      if (!valid) { ignoredCount++; continue; }
      const normalized = { ...item, id, date, space, owner, kind, time, duration };
      if (item.draft === true) normalized.draft = true;
      if (item.nickname != null) normalized.nickname = String(item.nickname);
      if (item.remark != null) normalized.remark = String(item.remark);
      if (item.groupId != null) normalized.groupId = String(item.groupId);
      bookings.push(normalized);
    }
    if (bookings.length) result[date] = bookings;
  }
  if (ignoredCount) console.warn(`已忽略 ${ignoredCount} 筆格式不完整的排課資料。`);
  return result;
}
function bookingsForDate(dateKey) {
  const list = rawBookings[dateKey] || [];
  return isBossManager() ? list : list.filter(booking => booking.draft !== true);
}
function rawBookingsForDate(dateKey) { return rawBookings[dateKey] || []; }
function allBookingsForDate(dateKey) { return bookingsForDate(dateKey).filter(Boolean); }
function uniqueTeamBookings(list) {
  const seen = new Set();
  return list.filter(b => {
    if (b.kind !== 'team') return true;
    const key = b.groupId || b.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function ownerChoices() {
  if (isAdmin()) return [...SCHEDULABLE_USERS, OTHER_OWNER];
  return SCHEDULABLE_USERS.includes(currentUser?.name) ? [currentUser.name, OTHER_OWNER] : [OTHER_OWNER];
}
function canCreateAt(space, dateKey) {
  if (!isDataReady()) return false;
  if (isAdmin()) return true;
  if (isAdminSpace(space)) return false;
  return canModifyPastBooking(currentUser.name, dateKey, fmtDate(new Date()));
}
function createDeniedByPastDate(space, dateKey) {
  return !isAdmin()
    && !isAdminSpace(space)
    && !canModifyPastBooking(currentUser.name, dateKey, fmtDate(new Date()));
}
function canEditBooking(booking) {
  if (!currentUser || !isDataReady()) return false;
  if (isAdmin()) return true;
  if (isAdminSpace(booking.space)) return false;
  if (booking.owner !== currentUser.name && booking.owner !== OTHER_OWNER) return false;
  return canModifyPastBooking(currentUser.name, booking.date, fmtDate(new Date()));
}
function canDeleteBooking(booking) { return canEditBooking(booking); }
function canUseKind(kind, space) { return kind !== 'team' || isTeamSpace(space); }
function overlaps(startA, durationA, startB, durationB) {
  const a1 = timeToSlot(startA), a2 = a1 + durationToSlots(durationA);
  const b1 = timeToSlot(startB), b2 = b1 + durationToSlots(durationB);
  return a1 < b2 && a2 > b1;
}
function conflictingBooking(list, space, time, duration, excludeIds = [], owner, kind) {
  return list.find(b => {
    if (!b || excludeIds.includes(b.id)) return false;
    if (Number(b.space) !== Number(space)) return false;
    if (kind === 'team' && b.kind === 'team' && b.groupId && excludeIds.some(id => id === b.id)) return false;
    return overlaps(time, duration, b.time, b.duration);
  }) || null;
}
function conflictingOwner(list, time, duration, excludeIds = [], owner, nickname, kind) {
  const ownerIdentity = bookingOwnerIdentity({ owner, nickname });
  if (!ownerIdentity) return null;
  return list.find(b => {
    if (!b || excludeIds.includes(b.id)) return false;
    if (bookingOwnerIdentity(b) !== ownerIdentity) return false;
    if (isAdminTeachingOverlapPair(bookingKindForOverlap({ kind }), bookingKindForOverlap(b))) return false;
    return overlaps(time, duration, b.time, b.duration);
  }) || null;
}
function validateRange(slot, duration) { return slot >= 0 && slot + durationToSlots(duration) <= SLOTS_PER_DAY; }

function showToast(message) {
  const toast = $('#rs-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}
function closeAdminContextMenu() {
  $('#rs-admin-context-menu')?.remove();
}
function openAdminContextMenu(event, items) {
  event.preventDefault();
  closeAdminContextMenu();
  const menu = document.createElement('div');
  menu.id = 'rs-admin-context-menu';
  menu.className = 'rs-admin-context-menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.textContent = item.label;
    button.disabled = !!item.disabled;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      closeAdminContextMenu();
      Promise.resolve(item.action()).catch(error => {
        console.error('行政時段右鍵操作失敗：', error);
        showToast('⚠️ 行政時段操作失敗，請稍後再試');
      });
    });
    menu.append(button);
  }
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
  menu.querySelector('button:not([disabled])')?.focus({ preventScroll: true });
}
function copyAdminBooking(booking) {
  adminBookingClipboard = { ...booking };
  showToast(`📋 已複製 ${booking.date} ${booking.time}–${endTime(booking.time, booking.duration)} ${ownerLabel(booking)}行政時段`);
}
async function pasteAdminBooking(dateKey) {
  if (!adminBookingClipboard) {
    showToast('⚠️ 請先在行政卡片上按右鍵複製');
    return;
  }
  if (mutationInProgress) {
    showToast('⏳ 上一筆排課仍在儲存，請稍候');
    return;
  }
  const prepared = buildAdminBookingPaste({
    source: adminBookingClipboard,
    targetDate: dateKey,
    id: firebaseId(dateKey),
  });
  if (!prepared) {
    showToast('⚠️ 行政時段只能貼到其他日期');
    return;
  }
  mutationInProgress = true;
  try {
    const ok = await persistChanges(dateKey, prepared.mutation);
    if (!ok) return;
    showToast(`✅ 已貼上 ${prepared.booking.time}–${endTime(prepared.booking.time, prepared.booking.duration)} ${ownerLabel(prepared.booking)}行政時段`);
    renderCurrentView();
  } finally {
    mutationInProgress = false;
  }
}
function setDataError(message, error) {
  dataStatus = 'error';
  dataErrorMessage = message;
  if (error) console.error(message, error);
  const loginError = $('#rs-login-error');
  if (loginError) loginError.textContent = message;
  renderCurrentView();
  showToast(message);
}

async function initDataLayer() {
  const config = window.RELIFE_FIREBASE_CONFIG;
  if (FORCE_LOCAL_DEMO) {
    useFallback = true;
  } else if (config && config.databaseURL) {
    try {
      const appModule = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
      const dbModule = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
      const app = appModule.getApps().find(item => item.name === 'schedule-redesign') || appModule.initializeApp(config, 'schedule-redesign');
      db = dbModule.getDatabase(app);
      firebaseApi = dbModule;
      useFallback = false;
    } catch (error) {
      if (!import.meta.env.DEV) {
        setDataError('⚠️ 雲端排課系統連線失敗，請重新整理後再試。', error);
        return;
      }
      console.warn('Firebase 初始化失敗；開發模式改用本機暫存。', error);
      useFallback = true;
    }
  } else if (import.meta.env.DEV) {
    useFallback = true;
  } else {
    setDataError('⚠️ 雲端排課系統設定不完整，暫時無法使用。');
    return;
  }
  window.RELIFE_SCHEDULE_BACKEND = useFallback ? (FORCE_LOCAL_DEMO ? 'local-demo' : 'local-fallback') : 'firebase';
  const scheduleRoot = $('#schedule-redesign');
  if (scheduleRoot) scheduleRoot.dataset.backend = window.RELIFE_SCHEDULE_BACKEND;
  if (useFallback) {
    try { rawBookings = normalizeBookings(JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}')); }
    catch { rawBookings = {}; }
    try { inboxByUser = normalizeInbox(JSON.parse(localStorage.getItem(INBOX_FALLBACK_KEY) || '{}')); }
    catch { inboxByUser = {}; }
    dataStatus = 'ready';
    dataErrorMessage = '';
    window.addEventListener('storage', event => {
      if (event.key === FALLBACK_KEY) {
        try {
          rawBookings = normalizeBookings(JSON.parse(event.newValue || '{}'));
          renderCurrentView();
        } catch (error) {
          console.error('本機排課資料解析失敗：', error);
          showToast('⚠️ 本機排課資料讀取失敗');
        }
      }
      if (event.key === INBOX_FALLBACK_KEY) {
        try {
          inboxByUser = normalizeInbox(JSON.parse(event.newValue || '{}'));
          updateInboxBadge();
          renderCurrentView();
        } catch (error) {
          console.error('本機收件箱資料解析失敗：', error);
        }
      }
    });
    renderRoot();
    renderCurrentView();
  } else {
    firebaseApi.onValue(firebaseApi.ref(db, ROOT_PATH), snapshot => {
      rawBookings = normalizeBookings(snapshot.val() || {});
      dataStatus = 'ready';
      dataErrorMessage = '';
      renderCurrentView();
    }, error => {
      setDataError('⚠️ 雲端資料讀取失敗，請檢查網路後重新整理。', error);
    });
    firebaseApi.onValue(firebaseApi.ref(db, INBOX_ROOT), snapshot => {
      inboxByUser = normalizeInbox(snapshot.val() || {});
      updateInboxBadge();
      renderCurrentView();
    }, error => {
      console.error('收件箱讀取失敗：', error);
    });
  }
}
async function persistInboxMessage(owner, message) {
  if (!message) return false;
  if (useFallback) {
    const next = { ...inboxByUser, [owner]: { ...(inboxByUser[owner] || {}), [message.id]: message } };
    try {
      localStorage.setItem(INBOX_FALLBACK_KEY, JSON.stringify(next));
      inboxByUser = next;
      return true;
    } catch (error) {
      console.error('本機收件箱儲存失敗：', error);
      return false;
    }
  }
  try {
    await firebaseApi.set(firebaseApi.ref(db, `${INBOX_ROOT}/${owner}/${message.id}`), message);
    return true;
  } catch (error) {
    console.error('收件箱通知寫入失敗：', error);
    return false;
  }
}

async function markInboxRead(owner, messageId) {
  if (!messageId) return;
  if (useFallback) {
    const userMessages = inboxByUser[owner];
    if (!userMessages) return;
    const nextMessages = withMessageRead(userMessages, messageId);
    if (nextMessages === userMessages) return;
    const next = { ...inboxByUser, [owner]: nextMessages };
    try {
      localStorage.setItem(INBOX_FALLBACK_KEY, JSON.stringify(next));
      inboxByUser = next;
      updateInboxBadge();
      renderCurrentView();
    } catch (error) {
      console.error('本機收件箱已讀標記失敗：', error);
    }
    return;
  }
  try {
    await firebaseApi.update(firebaseApi.ref(db, `${INBOX_ROOT}/${owner}/${messageId}`), { read: true });
  } catch (error) {
    console.error('收件箱已讀標記失敗：', error);
    showToast('⚠️ 已讀標記失敗，請檢查網路');
  }
}

async function markAllInboxRead() {
  const userMessages = inboxByUser[currentUser?.name];
  if (!userMessages) return;
  if (useFallback) {
    const nextMessages = withAllRead(userMessages);
    if (nextMessages === userMessages) return;
    const next = { ...inboxByUser, [currentUser.name]: nextMessages };
    try {
      localStorage.setItem(INBOX_FALLBACK_KEY, JSON.stringify(next));
      inboxByUser = next;
      updateInboxBadge();
      renderCurrentView();
    } catch (error) {
      console.error('本機收件箱全部已讀標記失敗：', error);
    }
    return;
  }
  try {
    await Promise.all(Object.keys(userMessages).map(id => (
      firebaseApi.update(firebaseApi.ref(db, `${INBOX_ROOT}/${currentUser.name}/${id}`), { read: true })
    )));
  } catch (error) {
    console.error('收件箱全部已讀標記失敗：', error);
    showToast('⚠️ 已讀標記失敗，請檢查網路');
  }
}

async function deleteInboxMessage(owner, messageId) {
  if (!messageId) return;
  if (useFallback) {
    const userMessages = inboxByUser[owner];
    if (!userMessages) return;
    const nextMessages = withoutMessage(userMessages, messageId);
    if (nextMessages === userMessages) return;
    const next = { ...inboxByUser, [owner]: nextMessages };
    try {
      localStorage.setItem(INBOX_FALLBACK_KEY, JSON.stringify(next));
      inboxByUser = next;
      updateInboxBadge();
      renderCurrentView();
    } catch (error) {
      console.error('本機收件箱刪除失敗：', error);
      showToast('⚠️ 刪除訊息失敗，請稍後再試');
    }
    return;
  }
  try {
    await firebaseApi.remove(firebaseApi.ref(db, `${INBOX_ROOT}/${owner}/${messageId}`));
  } catch (error) {
    console.error('收件箱刪除失敗：', error);
    showToast('⚠️ 刪除訊息失敗，請檢查網路');
  }
}

async function clearReadInboxMessages() {
  const userMessages = inboxByUser[currentUser?.name];
  if (!userMessages) return;
  const readIds = Object.values(userMessages).filter(message => message?.read === true).map(message => message.id);
  if (!readIds.length) return;
  if (useFallback) {
    const nextMessages = withoutReadMessages(userMessages);
    const next = { ...inboxByUser, [currentUser.name]: nextMessages };
    try {
      localStorage.setItem(INBOX_FALLBACK_KEY, JSON.stringify(next));
      inboxByUser = next;
      updateInboxBadge();
      renderCurrentView();
    } catch (error) {
      console.error('本機收件箱清除已讀失敗：', error);
      showToast('⚠️ 清除失敗，請稍後再試');
    }
    return;
  }
  try {
    await Promise.all(readIds.map(id => (
      firebaseApi.remove(firebaseApi.ref(db, `${INBOX_ROOT}/${currentUser.name}/${id}`))
    )));
  } catch (error) {
    console.error('收件箱清除已讀失敗：', error);
    showToast('⚠️ 清除失敗，請檢查網路');
  }
}

async function notifyNewBookings(records, operator) {
  const notified = new Set();
  for (const record of records) {
    const owner = record?.owner;
    if (!owner || owner === OTHER_OWNER || owner === operator || notified.has(owner)) continue;
    notified.add(owner);
    const message = buildInboxMessage({
      id: useFallback ? newId() : firebaseApi.push(firebaseApi.ref(db, INBOX_ROOT)).key,
      to: owner,
      from: operator,
      kind: record.kind,
      date: record.date,
      time: record.time,
      duration: record.duration,
      space: record.space,
      createdAt: Date.now(),
    });
    await persistInboxMessage(owner, message);
  }
}

async function notifyTeachingAdminOverlap(records, operator) {
  const notified = new Set();
  for (const record of records) {
    const owner = record?.owner;
    if (!owner || owner === OTHER_OWNER || notified.has(owner)) continue;
    const candidateList = [...allBookingsForDate(record.date), ...records.filter(r => r.date === record.date)];
    const existing = candidateList.find(b => b && b.id !== record.id
      && bookingOwnerIdentity(b) === bookingOwnerIdentity(record)
      && isAdminTeachingOverlapPair(bookingKindForOverlap(record), bookingKindForOverlap(b))
      && overlaps(record.time, record.duration, b.time, b.duration));
    if (!existing) continue;
    notified.add(owner);
    const existingLabel = existing.kind === 'admin' ? '行政時段' : (existing.kind === 'team' ? '團課' : '一般教練課');
    const remark = `與 ${existing.time}–${endTime(existing.time, existing.duration)} 的${existingLabel}重疊`;
    for (const to of ['老闆', '史昕銓']) {
      const message = buildInboxMessage({
        id: useFallback ? newId() : firebaseApi.push(firebaseApi.ref(db, INBOX_ROOT)).key,
        to, from: operator, kind: 'overlap',
        date: record.date, time: record.time, duration: record.duration, space: record.space,
        remark, createdAt: Date.now(),
      });
      await persistInboxMessage(to, message);
    }
  }
}

async function persistMutationCore(dateKey, mutation) {
  if (!isDataReady()) return { ok: false, reason: 'not-ready' };
  if (useFallback) {
    const currentNode = Object.fromEntries(rawBookingsForDate(dateKey).map(booking => [booking.id, booking]));
    const result = applyDateBookingMutation(currentNode, mutation);
    if (!result.ok) return { ok: false, reason: result.reason };
    const nextBookings = { ...rawBookings };
    if (result.value) nextBookings[dateKey] = Object.values(result.value);
    else delete nextBookings[dateKey];
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(nextBookings));
      rawBookings = nextBookings;
      return { ok: true, reason: null };
    } catch (error) {
      console.error('本機排課資料儲存失敗：', error);
      return { ok: false, reason: 'storage-error' };
    }
  }
  try {
    const result = await commitDateBookingMutation({
      reference: firebaseApi.ref(db, `${ROOT_PATH}/${dateKey}`),
      mutation,
      runTransaction: firebaseApi.runTransaction,
    });
    return { ok: result.committed, reason: result.committed ? null : result.reason };
  } catch (error) {
    console.error('Firebase 寫入失敗：', error);
    return { ok: false, reason: 'network-error' };
  }
}

async function persistChanges(dateKey, mutation) {
  const result = await persistMutationCore(dateKey, mutation);
  if (result.ok) return true;
  if (result.reason === 'not-ready') showToast('⚠️ 排課資料尚未同步完成，請稍後再試');
  else if (result.reason === 'storage-error') showToast('⚠️ 儲存失敗，請確認瀏覽器允許本機儲存');
  else if (result.reason === 'network-error') showToast('⚠️ 儲存失敗，請檢查網路後再試');
  else showToast(bookingMutationErrorMessage(result.reason));
  return false;
}

function draftBookings() {
  return Object.values(rawBookings).flat().filter(booking => booking?.draft === true);
}

async function publishAllDrafts() {
  if (!isBossManager() || mutationInProgress) return;
  const drafts = draftBookings().sort((a, b) => (
    String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time))
  ));
  if (!drafts.length) {
    showToast('目前沒有預排班需要上線');
    return;
  }
  if (!window.confirm(`將上線 ${drafts.length} 筆預排班，確定嗎？\n上線後所有使用者都會看到這些排課。`)) return;
  mutationInProgress = true;
  let published = 0;
  const failures = [];
  try {
    for (const booking of drafts) {
      const mutation = buildPublishDraftMutation(booking);
      if (!mutation) {
        failures.push({ booking, reason: 'invalid-mutation' });
        continue;
      }
      const result = await persistMutationCore(booking.date, mutation);
      if (result.ok) {
        published++;
        await notifyNewBookings([booking], '老闆');
        await notifyTeachingAdminOverlap([booking], '老闆');
      } else {
        failures.push({ booking, reason: result.reason });
      }
    }
  } finally {
    mutationInProgress = false;
    renderRoot();
    renderCurrentView();
  }
  if (failures.length) {
    console.warn('預排上線失敗明細：', failures.map(f => ({ date: f.booking.date, time: f.booking.time, owner: ownerLabel(f.booking), reason: f.reason })));
    const preview = failures.slice(0, 2).map(f => `${f.booking.date} ${f.booking.time} ${ownerLabel(f.booking)}`).join('、');
    showToast(`📤 已上線 ${published} 筆；${failures.length} 筆未上線：${preview}${failures.length > 2 ? ' 等' : ''}`);
  } else {
    showToast(`📤 已將 ${published} 筆預排班全部上線`);
  }
}
async function persistAdminResize(dateKey, patch) {
  if (!isDataReady()) {
    showToast('⚠️ 排課資料尚未同步完成，請稍後再試');
    return false;
  }
  if (useFallback) {
    const currentNode = Object.fromEntries(rawBookingsForDate(dateKey).map(booking => [booking.id, booking]));
    const result = applyDateBookingMutation(currentNode, { patches: [patch] });
    if (!result.ok) {
      showToast(bookingMutationErrorMessage(result.reason));
      return false;
    }
    const nextBookings = { ...rawBookings };
    if (result.value) nextBookings[dateKey] = Object.values(result.value);
    else delete nextBookings[dateKey];
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(nextBookings));
      rawBookings = nextBookings;
      return true;
    } catch (error) {
      console.error('本機行政時間儲存失敗：', error);
      showToast('⚠️ 儲存失敗，請確認瀏覽器允許本機儲存');
      return false;
    }
  }
  try {
    const result = await commitDateBookingMutation({
      reference: firebaseApi.ref(db, `${ROOT_PATH}/${dateKey}`),
      mutation: { patches: [patch] },
      runTransaction: firebaseApi.runTransaction,
    });
    if (result.committed) return true;
    showToast(bookingMutationErrorMessage(result.reason));
    return false;
  } catch (error) {
    console.error('Firebase 行政時間寫入失敗：', error);
    showToast('⚠️ 儲存失敗，請檢查網路後再試');
    return false;
  }
}
function newId() { return `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`; }
function firebaseId(dateKey) { return useFallback ? newId() : firebaseApi.push(firebaseApi.ref(db, `${ROOT_PATH}/${dateKey}`)).key; }

function renderRoot() {
  const root = $('#schedule-redesign');
  if (!root) return;
  if (!isLoggedIn()) { renderLogin(root); return; }
  renderShell(root);
}
function renderLogin(root) {
  root.innerHTML = `<div class="rs-login"><form class="rs-login-card" id="rs-login-form">
    <div class="rs-brand">RELIFE FITNESS</div>
    <h1>排課系統登入</h1>
    <p>請選擇使用者並輸入密碼，登入後查看個人月檢視與全館日檢視。</p>
    <div class="rs-field"><label for="rs-login-user">使用者名稱</label><select id="rs-login-user">${Object.keys(USERS).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select></div>
    <div class="rs-field"><label for="rs-login-password">密碼</label><input id="rs-login-password" type="password" inputmode="text" autocomplete="current-password" autofocus></div>
    <div class="rs-error" id="rs-login-error" role="alert" aria-live="polite">${escapeHtml(dataErrorMessage)}</div>
    <button class="rs-primary" type="submit">登入</button>
  </form><div class="rs-toast" id="rs-toast" role="status" aria-live="polite" aria-atomic="true"></div></div>`;
  $('#rs-login-form').addEventListener('submit', event => {
    event.preventDefault();
    const user = $('#rs-login-user').value;
    const password = $('#rs-login-password').value;
    if (PASSWORDS[user] !== password && PASSWORDS['老闆'] !== password) {
      $('#rs-login-error').textContent = '密碼錯誤，請重新輸入。';
      $('#rs-login-password').value = '';
      return;
    }
    currentUser = USERS[user];
    sessionStorage.setItem(SESSION_KEY, user);
    currentView = 'month';
    currentDate = new Date();
    startIdleTimeout();
    renderRoot();
    renderCurrentView();
  });
}
function renderShell(root) {
  root.innerHTML = `<div class="rs-app-shell">
    <header class="rs-header">
      <div class="rs-header-brand">RELIFE Fitness · 排課系統${FORCE_LOCAL_DEMO ? '<span class="rs-demo-badge">本機測試資料</span>' : ''}</div>
      <div class="rs-header-user"><span>${escapeHtml(currentUser.name)}</span><span class="rs-role-pill">${currentUser.role === 'admin' ? '管理員' : '一般使用者'}</span></div>
      <div class="rs-header-actions">
        <button type="button" class="rs-mobile-view-toggle rs-nav-btn active" id="rs-mobile-view-toggle">${currentView === 'month' ? '查看當日預約' : (currentView === 'inbox' ? '返回月檢視' : (isBossManager() ? '返回教練月檢視' : '返回月檢視'))}</button>
        <button type="button" class="rs-nav-btn rs-desktop-only ${currentView === 'month' ? 'active' : ''}" id="rs-month-btn" aria-pressed="${currentView === 'month'}">${isBossManager() ? '教練月檢視' : '我的月檢視'}</button>
        <button type="button" class="rs-nav-btn rs-desktop-only ${currentView === 'day' ? 'active' : ''}" id="rs-day-btn" aria-pressed="${currentView === 'day'}">全館日檢視</button>
        <button type="button" class="rs-nav-btn ${currentView === 'inbox' ? 'active' : ''}" id="rs-inbox-btn" aria-pressed="${currentView === 'inbox'}">📥 收件箱${unreadCount(inboxByUser[currentUser.name]) > 0 ? `<span class="rs-inbox-badge">${unreadCount(inboxByUser[currentUser.name])}</span>` : ''}</button>
        ${isBossManager() && draftBookings().length > 0 ? `<button type="button" class="rs-publish-btn" id="rs-publish-drafts" title="將所有預排班轉為正式排課，供全體使用者查看">📤 所有預排上線（${draftBookings().length}）</button>` : ''}
        <button type="button" class="rs-logout" id="rs-logout">登出</button>
      </div>
    </header>
    <main class="rs-main" id="rs-main"></main>
    <div id="rs-modal-host"></div>
    <div class="rs-toast" id="rs-toast" role="status" aria-live="polite" aria-atomic="true"></div>
  </div>`;
  $('#rs-mobile-view-toggle').addEventListener('click', () => {
    currentView = currentView === 'month' ? 'day' : 'month';
    selectedDateKey = null;
    renderRoot();
    renderCurrentView();
  });
  $('#rs-month-btn').addEventListener('click', () => { currentView = 'month'; renderRoot(); renderCurrentView(); });
  $('#rs-day-btn').addEventListener('click', () => { currentView = 'day'; selectedDateKey = null; renderRoot(); renderCurrentView(); });
  $('#rs-inbox-btn').addEventListener('click', () => { currentView = 'inbox'; selectedDateKey = null; renderRoot(); renderCurrentView(); });
  $('#rs-publish-drafts')?.addEventListener('click', () => {
    publishAllDrafts().catch(error => {
      console.error('預排上線失敗：', error);
      showToast('⚠️ 預排上線失敗，請稍後再試');
    });
  });
  $('#rs-logout').addEventListener('click', logout);
}
function updateInboxBadge() {
  const button = $('#rs-inbox-btn');
  if (!button || !currentUser) return;
  const count = unreadCount(inboxByUser[currentUser.name]);
  const existing = button.querySelector('.rs-inbox-badge');
  if (count > 0) {
    if (existing) existing.textContent = String(count);
    else button.insertAdjacentHTML('beforeend', `<span class="rs-inbox-badge">${count}</span>`);
  } else {
    existing?.remove();
  }
}
const IDLE_EVENT_TYPES = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'];

function startIdleTimeout() {
  disposeIdleTimeout();
  idleTimeout = createIdleTimeout({
    timeoutMs: FORCE_LOCAL_DEMO ? 12000 : IDLE_TIMEOUT_MS,
    onIdle() { logout('idle'); },
  });
  for (const type of IDLE_EVENT_TYPES) {
    window.addEventListener(type, idleTimeout.reset, { passive: true, capture: true });
  }
}

function disposeIdleTimeout() {
  if (!idleTimeout) return;
  for (const type of IDLE_EVENT_TYPES) {
    window.removeEventListener(type, idleTimeout.reset, { capture: true });
  }
  idleTimeout.dispose();
  idleTimeout = null;
}

function logout(reason) {
  disposeIdleTimeout();
  currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
  modalState = null;
  adminBookingClipboard = null;
  closeAdminContextMenu();
  renderRoot();
  if (reason === 'idle') showToast('🔒 已連續 30 分鐘未操作，為安全起見已自動登出。');
}
function renderCurrentView() {
  if (!isLoggedIn()) return;
  closeAdminContextMenu();
  if (adminResizeState) clearAdminResizeState();
  const main = $('#rs-main');
  if (!main) { renderRoot(); return; }
  if (dataStatus === 'error') {
    main.innerHTML = `<div class="rs-permission-note" role="alert">${escapeHtml(dataErrorMessage)}</div>`;
    return;
  }
  if (currentView === 'inbox') renderInboxView(main);
  else if (currentView === 'month') renderMonthView(main);
  else renderDayView(main);
}
function renderToolbar(title, subtitle) {
  return `<div class="rs-toolbar"><div><div class="rs-toolbar-title">${title}</div><div class="rs-toolbar-sub">${subtitle}</div></div><div class="rs-date-nav"><button type="button" data-nav="-1">◀ 上一個</button><span class="rs-date-title">${currentView === 'month' ? `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月` : formatDateCN(currentDate)}</span><button type="button" data-nav="1">下一個 ▶</button><button type="button" data-today="1">今天</button></div></div>`;
}

function renderInboxView(main) {
  const messages = Object.values(inboxByUser[currentUser.name] || {})
    .sort((a, b) => b.createdAt - a.createdAt);
  const unread = unreadCount(inboxByUser[currentUser.name]);
  let html = renderToolbar('📥 收件箱', '有人為你安排排課時，會在這裡通知你');
  if (!messages.length) {
    html += '<div class="rs-inbox-empty">📭 目前沒有訊息。當有人為你安排新的行政時段或教練課時，會顯示在這裡。</div>';
  } else {
    const readCount = messages.filter(message => message.read === true).length;
    let toolbar = '';
    if (unread > 0) {
      toolbar += `<button type="button" class="rs-secondary" id="rs-inbox-read-all">✔ 全部標記已讀（${unread}）</button>`;
    }
    if (readCount > 0) {
      toolbar += `<button type="button" class="rs-secondary rs-danger-text" id="rs-inbox-clear-read">🗑️ 清除所有已讀（${readCount}）</button>`;
    }
    if (toolbar) {
      html += `<div class="rs-inbox-toolbar">${toolbar}</div>`;
    }
    html += '<ul class="rs-inbox-list">' + messages.map(message => {
      const label = message.kind === 'admin' ? '行政時段'
        : (message.kind === 'team' ? '團課'
          : (message.kind === 'overlap' ? '⚠️ 排課重疊通知' : '一般教練課'));
      const unreadMark = message.read !== true ? '<span class="rs-inbox-dot" aria-label="未讀"></span>' : '';
      return `<li class="rs-inbox-item ${message.read !== true ? 'unread' : ''}" data-inbox-id="${escapeHtml(message.id)}" role="button" tabindex="0">
        <div class="rs-inbox-body">
          <div class="rs-inbox-line1">${unreadMark}<strong>${label}</strong> · ${spaceName(message.space)}</div>
          <div class="rs-inbox-line2">📅 ${formatDateCN(parseDate(message.date))} ${message.time}–${endTime(message.time, message.duration)}</div>
          <div class="rs-inbox-line3">由 ${escapeHtml(message.from)} 安排${message.remark ? ` · ${escapeHtml(message.remark)}` : ''}</div>
        </div>
        <button type="button" class="rs-inbox-delete" data-inbox-delete="${escapeHtml(message.id)}" aria-label="刪除這則訊息" title="刪除訊息">🗑️</button>
      </li>`;
    }).join('') + '</ul>';
  }
  main.innerHTML = html;
  $('#rs-inbox-read-all')?.addEventListener('click', () => {
    markAllInboxRead().catch(error => console.error('全部已讀失敗：', error));
  });
  $('#rs-inbox-clear-read')?.addEventListener('click', () => {
    clearReadInboxMessages().catch(error => console.error('清除已讀訊息失敗：', error));
  });
  $$('[data-inbox-id]', main).forEach(item => {
    const mark = () => markInboxRead(currentUser.name, item.dataset.inboxId).catch(error => console.error('已讀標記失敗：', error));
    item.addEventListener('click', mark);
    item.addEventListener('keydown', event => {
      if (event.target !== item) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mark(); }
    });
  });
  $$('[data-inbox-delete]', main).forEach(button => {
    button.addEventListener('click', event => {
      event.stopPropagation();
      deleteInboxMessage(currentUser.name, button.dataset.inboxDelete).catch(error => console.error('刪除訊息失敗：', error));
    });
  });
}
function attachDateNav(container) {
  $$('[data-nav]', container).forEach(button => button.addEventListener('click', () => {
    const delta = Number(button.dataset.nav);
    if (currentView === 'month') { currentDate.setDate(1); currentDate.setMonth(currentDate.getMonth() + delta); }
    else currentDate.setDate(currentDate.getDate() + delta);
    selectedDateKey = null;
    renderCurrentView();
  }));
  $('[data-today]', container)?.addEventListener('click', () => { currentDate = new Date(); selectedDateKey = null; renderCurrentView(); });
}
function monthBookingsForUser(dateKey) {
  const list = bookingsForDate(dateKey).filter(b => isBossManager() ? isSchedulableBookingOwner(b.owner) : b.owner === currentUser.name);
  return uniqueTeamBookings(list).sort((a, b) => timeToSlot(a.time) - timeToSlot(b.time));
}
function renderMonthView(main) {
  const year = currentDate.getFullYear(), month = currentDate.getMonth();
  const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
  const bossOverview = isBossManager();
  let html = renderToolbar(bossOverview ? '教練月檢視' : '我的月檢視', bossOverview ? '查看教練與場租人員的排課概況' : `${escapeHtml(currentUser.name)} 的行政排班與教練課程`);
  if (isAdmin()) html += '<div class="rs-permission-note">管理員：在行政排班項目上按右鍵可複製，於其他日期的格子按右鍵可貼上。同一時間最多 3 位教練。</div>';
  html += '<div class="rs-month-grid">' + ['日', '一', '二', '三', '四', '五', '六'].map(day => `<div class="rs-weekday">${day}</div>`).join('') + '</div>';
  html += '<div class="rs-month-grid" id="rs-month-days">';
  for (let i = first.getDay() - 1; i >= 0; i--) html += monthDayHtml(new Date(year, month, -i), true);
  for (let day = 1; day <= last.getDate(); day++) html += monthDayHtml(new Date(year, month, day), false);
  const cells = first.getDay() + last.getDate();
  for (let day = 1; day <= (7 - cells % 7) % 7; day++) html += monthDayHtml(new Date(year, month + 1, day), true);
  html += '</div><div class="rs-stats" id="rs-stats"></div>';
  main.innerHTML = html;
  attachDateNav(main);
  attachMonthClipboard(main);
  $$('.rs-month-day:not(.other)', main).forEach(day => day.addEventListener('click', () => {
    const key = day.dataset.date;
    if (selectedDateKey === key) { currentDate = parseDate(key); currentView = 'day'; selectedDateKey = null; renderRoot(); renderCurrentView(); }
    else { currentDate = parseDate(key); selectedDateKey = key; $$('.rs-month-day.selected', main).forEach(item => item.classList.remove('selected')); day.classList.add('selected'); }
  }));
  renderStats($('#rs-stats', main), year, month);
}
function monthDayHtml(date, other) {
  const key = fmtDate(date);
  const classes = ['rs-month-day'];
  if (other) classes.push('other');
  if (isToday(date)) classes.push('today');
  if (selectedDateKey === key) classes.push('selected');
  const items = other ? [] : monthBookingsForUser(key);
  const content = items.length ? items.map(b => `<div class="rs-day-item ${b.kind === 'team' ? 'team' : (isAdminSpace(b.space) ? 'admin' : 'coach')} ${ownerColorClass(b.owner)}${b.draft === true ? ' draft' : ''}" data-booking-id="${escapeHtml(b.id)}"><strong>${isBossManager() ? `${escapeHtml(ownerLabel(b))}｜` : ''}${courseLabel(b)}：</strong>${escapeHtml(b.time)}–${escapeHtml(endTime(b.time, b.duration))}${b.draft === true ? ' 📝預排' : ''}${b.remark ? `<br>📝 ${escapeHtml(b.remark)}` : ''}</div>`).join('') : (!other ? '<div class="rs-day-empty">尚無排課</div>' : '');
  return `<div class="${classes.join(' ')}" data-date="${key}"><div class="rs-day-number">${date.getDate()}</div>${content}</div>`;
}
function statsForOwner(owner, year, month) {
  let adminMinutes = 0, coachClasses = 0, teamClasses = 0;
  const groups = new Set();
  const last = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= last; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`;
    for (const booking of bookingsForDate(key)) {
      if (booking.draft === true) continue;
      if (booking.owner !== owner) continue;
      if (isAdminSpace(booking.space)) adminMinutes += Number(booking.duration) || 0;
      else if (booking.kind === 'team') {
        const group = booking.groupId || booking.id;
        if (!groups.has(group)) { groups.add(group); teamClasses++; }
      } else coachClasses++;
    }
  }
  return { adminHours: adminMinutes / 60, coachClasses, teamClasses };
}
function renderStats(container, year, month) {
  const owners = isAdmin() ? SCHEDULABLE_USERS : [currentUser.name];
  container.innerHTML = owners.map(owner => {
    const stats = statsForOwner(owner, year, month);
    return `<section class="rs-stat-card"><h3>📊 ${escapeHtml(owner)} 本月統計</h3>
      <div class="rs-stat-line"><span>行政時數</span><span class="rs-stat-value">${stats.adminHours % 1 ? stats.adminHours.toFixed(1) : stats.adminHours} 小時</span></div>
      <div class="rs-stat-line"><span>教練堂數</span><span class="rs-stat-value">${stats.coachClasses} 堂</span></div>
      <div class="rs-stat-line"><span>團課堂數</span><span class="rs-stat-value">${stats.teamClasses} 堂</span></div>
    </section>`;
  }).join('');
}
function findBookingAtSlot(bookings, space, slot) {
  return bookings.find(b => Number(b.space) === Number(space) && timeToSlot(b.time) <= slot && slot < timeToSlot(b.time) + durationToSlots(b.duration));
}
function renderAdminTimeline(dayBookings) {
  const adminBookings = dayBookings
    .filter(booking => isAdminSpace(booking.space))
    .map(booking => {
      const start = timeToSlot(booking.time);
      return { ...booking, start, end: start + durationToSlots(booking.duration) };
    });
  const segments = buildAdminSegments(adminBookings);
  const bands = [];
  for (const segment of segments) {
    let band = bands[bands.length - 1];
    if (!band || band.start !== segment.start || band.end !== segment.end) {
      band = { start: segment.start, end: segment.end, count: segment.count, items: [] };
      bands.push(band);
    }
    band.items.push(segment);
  }
  const canAdd = canCreateAt(1);
  const slotStates = buildAdminSlotStates(adminBookings, SLOTS_PER_DAY);
  const addSlots = canAdd ? slotStates.filter(state => state.canAdd).map(state => {
    const top = state.slot / SLOTS_PER_DAY * 100;
    const height = 100 / SLOTS_PER_DAY;
    const mode = state.count ? 'rail' : 'empty';
    const label = `${slotToTime(state.slot)} 新增行政排班，目前 ${state.count} 位教練`;
    return `<button type="button" class="rs-admin-add-slot ${mode}" style="top:${top}%;height:${height}%" data-create-space="1" data-create-slot="${state.slot}" aria-label="${label}" title="${label}"><span>＋</span></button>`;
  }).join('') : '';
  const bookingBands = bands.map(band => {
    const top = band.start / SLOTS_PER_DAY * 100;
    const height = (band.end - band.start) / SLOTS_PER_DAY * 100;
    const reserveRail = canAdd && band.count === ADMIN_CAPACITY - 1;
    const segmentSlots = band.end - band.start;
    const densityClass = segmentSlots === 1 ? 'is-tiny' : (segmentSlots === 2 ? 'is-short' : '');
    const cards = band.items.map(segment => {
      const bookingEnd = endTime(segment.time, segment.duration);
      const continuation = `${segment.continuesBefore ? ' continues-before' : ''}${segment.continuesAfter ? ' continues-after' : ''}`;
      const ownerClass = ownerColorClass(segment.owner);
      const remark = segment.remark ? `<span class="rs-admin-remark">📝 ${escapeHtml(segment.remark)}</span>` : '';
      const label = `編輯 ${ownerLabel(segment)} 行政時段 ${segment.time} 至 ${bookingEnd}`;
      const canResize = canEditBooking(segment);
      const startResize = canResize && !segment.continuesBefore
        ? `<button type="button" class="rs-admin-resize-handle start" data-resize-booking-id="${escapeHtml(segment.id)}" data-resize-edge="start" role="slider" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="${SLOTS_PER_DAY}" aria-valuenow="${timeToSlot(segment.time)}" aria-valuetext="${escapeHtml(segment.time)}" aria-label="調整 ${escapeHtml(ownerLabel(segment))} 行政開始時間，目前 ${escapeHtml(segment.time)}。拖曳，或使用上下方向鍵預覽、Enter 確認、Escape 取消" title="拖曳調整開始時間"><span aria-hidden="true"></span></button>`
        : '';
      const endResize = canResize && !segment.continuesAfter
        ? `<button type="button" class="rs-admin-resize-handle end" data-resize-booking-id="${escapeHtml(segment.id)}" data-resize-edge="end" role="slider" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="${SLOTS_PER_DAY}" aria-valuenow="${timeToSlot(segment.time) + durationToSlots(segment.duration)}" aria-valuetext="${escapeHtml(bookingEnd)}" aria-label="調整 ${escapeHtml(ownerLabel(segment))} 行政結束時間，目前 ${escapeHtml(bookingEnd)}。拖曳，或使用上下方向鍵預覽、Enter 確認、Escape 取消" title="拖曳調整結束時間"><span aria-hidden="true"></span></button>`
        : '';
      return `<div class="rs-admin-card-wrap"><button type="button" class="rs-admin-card${ownerClass ? ` ${ownerClass}` : ''}${segment.draft === true ? ' draft' : ''}${continuation}" data-booking-id="${escapeHtml(segment.id)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span class="rs-admin-name">${escapeHtml(ownerLabel(segment))}</span><span class="rs-admin-time"><span>${escapeHtml(segment.time)}</span><span class="rs-admin-time-sep">–</span><span>${escapeHtml(bookingEnd)}</span></span>${remark}</button>${startResize}${endResize}</div>`;
    }).join('');
    return `<div class="rs-admin-band count-${band.count} ${densityClass}${reserveRail ? ' can-add' : ''}" style="top:${top}%;height:${height}%;grid-template-columns:repeat(${band.count},minmax(0,1fr))">${cards}</div>`;
  }).join('');
  return `<div class="rs-admin-timeline" style="height:${SLOTS_PER_DAY * 30}px">${addSlots}${bookingBands}<div class="rs-admin-resize-preview" hidden aria-live="polite"></div></div>`;
}
function adminRangeForBooking(booking) {
  const start = timeToSlot(booking.time);
  return { start, end: start + durationToSlots(booking.duration) };
}
function setAdminResizePreview(state) {
  const { preview, timeline, booking, range } = state;
  const startTime = slotToTime(range.start);
  const endTimeValue = slotToTime(range.end);
  preview.hidden = false;
  preview.style.top = `${range.start / SLOTS_PER_DAY * 100}%`;
  preview.style.height = `${(range.end - range.start) / SLOTS_PER_DAY * 100}%`;
  preview.textContent = `${ownerLabel(booking)}\n${startTime}–${endTimeValue}`;
  preview.setAttribute('aria-label', `${ownerLabel(booking)} 行政時間預覽 ${startTime} 至 ${endTimeValue}`);
  const handleSlot = state.edge === 'start' ? range.start : range.end;
  state.handle.setAttribute('aria-valuenow', String(handleSlot));
  state.handle.setAttribute('aria-valuetext', slotToTime(handleSlot));
  timeline.classList.add('is-resizing');
  $$('[data-booking-id]', timeline)
    .filter(card => card.dataset.bookingId === booking.id)
    .forEach(card => card.closest('.rs-admin-card-wrap')?.classList.add('is-resizing-source'));
}
function clearAdminResizeState() {
  const state = adminResizeState;
  if (!state) return;
  window.removeEventListener('pointermove', moveAdminResizePointer);
  window.removeEventListener('pointerup', endAdminResizePointer);
  window.removeEventListener('pointercancel', cancelAdminResizePointer);
  state.handle.removeAttribute('aria-grabbed');
  const originalSlot = state.edge === 'start' ? state.originalRange.start : state.originalRange.end;
  state.handle.setAttribute('aria-valuenow', String(originalSlot));
  state.handle.setAttribute('aria-valuetext', slotToTime(originalSlot));
  state.timeline.classList.remove('is-resizing');
  state.preview.hidden = true;
  $$('.rs-admin-card-wrap.is-resizing-source', state.timeline)
    .forEach(card => card.classList.remove('is-resizing-source'));
  adminResizeState = null;
}
function cancelAdminResizePointer(event) {
  if (event?.pointerId != null && event.pointerId !== adminResizeState?.pointerId) return;
  clearAdminResizeState();
}
function autoScrollAdminTable(clientY, tableWrap) {
  if (!tableWrap) return;
  const rect = tableWrap.getBoundingClientRect();
  const edgeSize = 54;
  if (clientY < rect.top + edgeSize) tableWrap.scrollTop -= 30;
  else if (clientY > rect.bottom - edgeSize) tableWrap.scrollTop += 30;
}
function moveAdminResizePointer(event) {
  const state = adminResizeState;
  if (!state || event.pointerId !== state.pointerId) return;
  event.preventDefault();
  autoScrollAdminTable(event.clientY, state.tableWrap);
  const rect = state.timeline.getBoundingClientRect();
  const targetSlot = pointerYToAdminSlot({
    clientY: event.clientY,
    top: rect.top,
    height: rect.height,
    totalSlots: SLOTS_PER_DAY,
  });
  state.range = resizeAdminRange({
    ...state.originalRange,
    edge: state.edge,
    targetSlot,
    totalSlots: SLOTS_PER_DAY,
  });
  setAdminResizePreview(state);
}
async function commitAdminResize(booking, dateKey, range, focusEdge = null) {
  const originalRange = adminRangeForBooking(booking);
  if (range.start === originalRange.start && range.end === originalRange.end) return;
  if (mutationInProgress) {
    showToast('⏳ 上一筆排課仍在儲存，請稍候');
    return;
  }
  const nextTime = slotToTime(range.start);
  const nextDuration = (range.end - range.start) * SLOT_MINUTES;
  mutationInProgress = true;
  try {
    const ok = await persistAdminResize(dateKey, {
      id: booking.id,
      expected: {
        time: booking.time,
        duration: Number(booking.duration),
        space: Number(booking.space),
        owner: booking.owner,
        kind: booking.kind,
      },
      changes: { time: nextTime, duration: nextDuration },
    });
    if (ok) showToast(`✅ 行政時間已調整為 ${nextTime}–${slotToTime(range.end)}`);
  } finally {
    mutationInProgress = false;
    renderCurrentView();
    if (focusEdge) {
      requestAnimationFrame(() => {
        $$('[data-resize-booking-id]')
          .find(handle => handle.dataset.resizeBookingId === booking.id && handle.dataset.resizeEdge === focusEdge)
          ?.focus({ preventScroll: true });
      });
    }
  }
}
async function endAdminResizePointer(event) {
  const state = adminResizeState;
  if (!state || event.pointerId !== state.pointerId) return;
  event.preventDefault();
  const { booking, dateKey, edge, range } = state;
  clearAdminResizeState();
  await commitAdminResize(booking, dateKey, range, edge);
}
function beginAdminResizePointer(event, booking, dateKey) {
  if (adminResizeState?.input === 'keyboard') clearAdminResizeState();
  if (mutationInProgress || adminResizeState || !canEditBooking(booking)) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = event.currentTarget;
  const timeline = handle.closest('.rs-admin-timeline');
  const preview = $('.rs-admin-resize-preview', timeline);
  if (!timeline || !preview) return;
  const originalRange = adminRangeForBooking(booking);
  adminResizeState = {
    booking,
    dateKey,
    input: 'pointer',
    edge: handle.dataset.resizeEdge,
    handle,
    pointerId: event.pointerId,
    timeline,
    preview,
    tableWrap: timeline.closest('.rs-table-wrap'),
    originalRange,
    range: originalRange,
  };
  handle.setAttribute('aria-grabbed', 'true');
  try { handle.setPointerCapture(event.pointerId); } catch { /* pointer capture 非必要 */ }
  setAdminResizePreview(adminResizeState);
  window.addEventListener('pointermove', moveAdminResizePointer, { passive: false });
  window.addEventListener('pointerup', endAdminResizePointer, { passive: false });
  window.addEventListener('pointercancel', cancelAdminResizePointer);
}
async function handleAdminResizeKeydown(event, booking, dateKey) {
  if (mutationInProgress || !canEditBooking(booking)) return;
  const handle = event.currentTarget;
  const edge = event.currentTarget.dataset.resizeEdge;
  const originalRange = adminRangeForBooking(booking);
  const currentState = adminResizeState?.input === 'keyboard' && adminResizeState.handle === handle
    ? adminResizeState
    : null;
  if (adminResizeState && !currentState) return;
  if (!currentState && !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const range = currentState?.range || originalRange;
  const command = keyboardAdminResizeCommand({
    edge,
    key: event.key,
    range,
    originalRange,
    totalSlots: SLOTS_PER_DAY,
  });
  if (!command) return;
  event.preventDefault();
  event.stopPropagation();
  if (command.action === 'cancel') {
    clearAdminResizeState();
    showToast('已取消行政時間調整');
    return;
  }
  if (command.action === 'commit') {
    const nextRange = command.range;
    clearAdminResizeState();
    await commitAdminResize(booking, dateKey, nextRange, edge);
    return;
  }
  if (command.range.start === range.start && command.range.end === range.end) {
    showToast('已達行政時間可調整的邊界');
    return;
  }
  if (!currentState) {
    const timeline = handle.closest('.rs-admin-timeline');
    const preview = timeline ? $('.rs-admin-resize-preview', timeline) : null;
    if (!timeline || !preview) return;
    adminResizeState = {
      booking,
      dateKey,
      input: 'keyboard',
      edge,
      handle,
      pointerId: null,
      timeline,
      preview,
      tableWrap: timeline.closest('.rs-table-wrap'),
      originalRange,
      range: command.range,
    };
    handle.setAttribute('aria-grabbed', 'true');
  } else {
    currentState.range = command.range;
  }
  setAdminResizePreview(adminResizeState);
}
function attachAdminResize(main, dayBookings, dateKey) {
  $$('[data-resize-booking-id]', main).forEach(handle => {
    const booking = dayBookings.find(item => item.id === handle.dataset.resizeBookingId);
    if (!booking) return;
    handle.addEventListener('pointerdown', event => beginAdminResizePointer(event, booking, dateKey));
    handle.addEventListener('lostpointercapture', cancelAdminResizePointer);
    handle.addEventListener('blur', () => {
      if (adminResizeState?.input === 'keyboard' && adminResizeState.handle === handle) {
        clearAdminResizeState();
      }
    });
    handle.addEventListener('keydown', event => {
      handleAdminResizeKeydown(event, booking, dateKey).catch(error => {
        console.error('鍵盤調整行政時間失敗：', error);
        showToast('⚠️ 行政時間調整失敗，請稍後再試');
      });
    });
  });
}
function attachAdminClipboard(main, dayBookings, dateKey) {
  const timeline = $('.rs-admin-timeline', main);
  if (!timeline || !canCreateAt(1)) return;
  timeline.addEventListener('contextmenu', event => {
    const target = event.target instanceof Element ? event.target : null;
    const bookingElement = target?.closest('[data-booking-id], [data-resize-booking-id]');
    const bookingId = bookingElement?.dataset.bookingId || bookingElement?.dataset.resizeBookingId;
    const booking = bookingId ? dayBookings.find(item => item.id === bookingId) : null;
    const items = [];
    if (booking && isAdminSpace(booking.space) && canEditBooking(booking)) {
      items.push({ label: '📋 複製行政時段', action: () => copyAdminBooking(booking) });
    }
    if (adminBookingClipboard) {
      const sameDate = adminBookingClipboard.date === dateKey;
      items.push({
        label: sameDate ? '此日期為複製來源' : `📌 貼上到 ${dateKey}`,
        disabled: sameDate,
        action: () => pasteAdminBooking(dateKey),
      });
    } else if (!booking) {
      items.push({ label: '請先在行政卡片上按右鍵複製', disabled: true, action: () => {} });
    }
    if (items.length) openAdminContextMenu(event, items);
  });
}
function attachMonthClipboard(main) {
  const grid = $('#rs-month-days', main);
  if (!grid || !canCreateAt(1)) return;
  grid.addEventListener('contextmenu', event => {
    const target = event.target instanceof Element ? event.target : null;
    const day = target?.closest('.rs-month-day[data-date]');
    if (!day) return;
    const dateKey = day.dataset.date;
    const bookingId = target?.closest('[data-booking-id]')?.dataset.bookingId;
    const booking = bookingId ? allBookingsForDate(dateKey).find(item => item.id === bookingId) : null;
    const items = [];
    if (booking && isAdminSpace(booking.space) && canEditBooking(booking)) {
      items.push({ label: '📋 複製行政時段', action: () => copyAdminBooking(booking) });
    }
    if (adminBookingClipboard) {
      const sameDate = adminBookingClipboard.date === dateKey;
      items.push({
        label: sameDate ? '此日期為複製來源' : `📌 貼上到 ${dateKey}`,
        disabled: sameDate,
        action: () => pasteAdminBooking(dateKey),
      });
    } else if (!booking) {
      items.push({ label: '請先在行政卡片上按右鍵複製', disabled: true, action: () => {} });
    }
    if (items.length) openAdminContextMenu(event, items);
  });
}
function renderDayView(main) {
  const dateKey = fmtDate(currentDate);
  const dayBookings = allBookingsForDate(dateKey);
  let html = renderToolbar('全館日檢視', `${formatDateCN(currentDate)} · 所有人排課總表`);
  html += `<div class="rs-permission-note">${isAdmin() ? `管理員：拖曳行政卡片上下邊框可調整時間；在行政卡片按右鍵可複製，切換日期後於行政欄按右鍵貼上。同一時間最多 ${ADMIN_CAPACITY} 位教練。` : '一般使用者：可編輯教練課與「其他」課程；行政時段僅管理員可編輯。'}</div>`;
  html += '<div class="rs-table-wrap"><table class="rs-day-table"><thead><tr><th class="time">時間</th>' + SPACE_NAMES.map(name => `<th class="resource">${name}</th>`).join('') + '</tr></thead><tbody>';
  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    html += `<tr class="${slot % 4 === 0 ? 'hour' : ''}"><td class="time">${slotToTime(slot)}</td>`;
    for (let space = 1; space <= SPACES; space++) {
      if (isAdminSpace(space)) {
        if (slot === 0) html += `<td class="rs-admin-column" rowspan="${SLOTS_PER_DAY}">${renderAdminTimeline(dayBookings)}</td>`;
        continue;
      }
      const booking = findBookingAtSlot(dayBookings, space, slot);
      if (booking && timeToSlot(booking.time) !== slot) continue;
      if (!booking) {
        const clickable = canCreateAt(space, dateKey);
        const blockedByPastDate = !clickable && createDeniedByPastDate(space, dateKey);
        html += `<td class="rs-slot empty" ${clickable ? `data-create-space="${space}" data-create-slot="${slot}"` : `title="${blockedByPastDate ? '過去日期的排課只有老闆與史昕銓可以新增' : '只有管理員可以編輯行政時段'}"`}></td>`;
        continue;
      }
      const display = `${escapeHtml(ownerLabel(booking))}${booking.kind === 'team' ? '（團課）' : ''}`;
      const remark = booking.remark ? `<div class="rs-remark">📝 ${escapeHtml(booking.remark)}</div>` : '';
      html += `<td class="rs-slot booked ${booking.kind === 'team' ? 'team' : (isAdminSpace(booking.space) ? 'admin' : 'coach')} ${ownerColorClass(booking.owner)}" rowspan="${durationToSlots(booking.duration)}" data-booking-id="${escapeHtml(booking.id)}"><div>${display}</div><small>${escapeHtml(booking.time)}–${escapeHtml(endTime(booking.time, booking.duration))}</small>${remark}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  main.innerHTML = html;
  attachDateNav(main);
  $$('[data-create-space]', main).forEach(cell => cell.addEventListener('click', () => openCreateModal(Number(cell.dataset.createSpace), Number(cell.dataset.createSlot), dateKey, cell)));
  $$('[data-booking-id]', main).forEach(cell => cell.addEventListener('click', () => {
    const booking = dayBookings.find(item => item.id === cell.dataset.bookingId);
    if (booking) openEditModal(booking, dateKey, cell);
  }));
  attachAdminResize(main, dayBookings, dateKey);
  attachAdminClipboard(main, dayBookings, dateKey);
}
function buildModal(mode, booking, space, slot, dateKey) {
  const editing = mode === 'edit';
  const owner = editing ? booking.owner : (SCHEDULABLE_USERS.includes(currentUser.name) ? currentUser.name : SCHEDULABLE_USERS[0]);
  const kind = editing ? (booking.kind || (isAdminSpace(space) ? 'admin' : 'coach')) : (isAdminSpace(space) ? 'admin' : 'coach');
  const durations = isAdminSpace(space) ? ADMIN_DURATIONS : COACH_DURATIONS;
  const duration = editing ? Number(booking.duration) : (isAdminSpace(space) ? 90 : 75);
  const owners = ownerChoices();
  const canChangeKind = isTeamSpace(space);
  const kindOptions = isAdminSpace(space)
    ? '<option value="admin" selected>行政</option>'
    : `<option value="coach" ${kind === 'coach' ? 'selected' : ''}>一般教練課</option>${canChangeKind ? `<option value="team" ${kind === 'team' ? 'selected' : ''}>團課</option>` : ''}`;
  const title = editing ? '修改／取消排課' : '新增排課';
  const info = editing ? `${spaceName(booking.space)} · ${booking.time}–${endTime(booking.time, booking.duration)} · ${ownerLabel(booking)}${booking.kind === 'team' ? '（團課）' : ''}` : `${spaceName(space)} · ${slotToTime(slot)} · ${formatDateCN(parseDate(dateKey))}`;
  const showDraftButton = !editing && isBossManager() && isAdminSpace(space);
  return `<div class="rs-modal-overlay" id="rs-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rs-modal-title"><form class="rs-modal" id="rs-booking-form">
    <button type="button" class="rs-modal-close" id="rs-modal-close" aria-label="關閉排課視窗">✕</button><h2 id="rs-modal-title">${title}</h2><div class="rs-modal-sub">${escapeHtml(info)}</div>
    ${editing ? `<div class="rs-info-box">📅 ${formatDateCN(parseDate(dateKey))}<br>🏠 ${spaceName(booking.space)}<br>👤 ${escapeHtml(ownerLabel(booking))}${booking.draft === true ? '<br>📝 預排班（未上線）' : ''}</div>` : ''}
    <label for="rs-owner">使用者</label><select id="rs-owner">${owners.map(item => `<option value="${escapeHtml(item)}" ${item === owner ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select>
    <div id="rs-nickname-row" class="${owner === OTHER_OWNER ? '' : 'rs-hidden'}"><label for="rs-nickname">其他暱稱</label><input id="rs-nickname" value="${escapeHtml(editing ? (booking.nickname || '') : '')}" placeholder="例如：小明"></div>
    <label for="rs-kind">課程類型</label><select id="rs-kind" ${canChangeKind ? '' : 'disabled'}>${kindOptions}</select>
    <div id="rs-team-note" class="rs-permission-note ${kind === 'team' ? '' : 'rs-hidden'}">團課會同時佔用二樓自由重量(1)、二樓自由重量(2)、二樓機動空間。</div>
    <label for="rs-duration">課程時長</label><select id="rs-duration">${durations.map(item => `<option value="${item}" ${item === duration ? 'selected' : ''}>${isAdminSpace(space) ? `${item / 60} 小時` : `${item} 分鐘`}</option>`).join('')}</select>
    <label for="rs-remark">📝 備註</label><input id="rs-remark" value="${escapeHtml(editing ? (booking.remark || '') : '')}" placeholder="選填，例如：體驗課、調整姿勢">
    <div class="rs-modal-actions"><button type="button" class="rs-secondary" id="rs-modal-cancel">關閉</button>${editing && canDeleteBooking(booking) ? '<button type="button" class="rs-danger-btn" id="rs-delete">取消排課</button>' : ''}${showDraftButton ? '<button type="button" class="rs-draft-btn" id="rs-draft-submit">📝 預排班</button>' : ''}<button type="submit" class="rs-primary">${editing ? '確認修改' : '確認預約'}</button></div>
  </form></div>`;
}
function openCreateModal(space, slot, dateKey, triggerElement = null) {
  if (!canCreateAt(space, dateKey)) {
    showToast(createDeniedByPastDate(space, dateKey) ? '⚠️ 過去日期的排課只有老闆與史昕銓可以新增。' : '⚠️ 行政時段只有管理員可以編輯');
    return;
  }
  lastModalTrigger = triggerElement || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  modalState = { mode: 'create', space, slot, dateKey };
  mountModal();
}
function openEditModal(booking, dateKey, triggerElement = null) {
  if (!canEditBooking(booking)) { showToast('🔒 目前帳號沒有編輯這筆排課的權限'); return; }
  lastModalTrigger = triggerElement || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const originalRecords = booking.groupId
    ? allBookingsForDate(dateKey).filter(item => item.groupId === booking.groupId)
    : [booking];
  modalState = {
    mode: 'edit',
    booking,
    originalRecords: originalRecords.map(item => ({ ...item })),
    space: Number(booking.space),
    slot: timeToSlot(booking.time),
    dateKey,
  };
  mountModal();
}
function mountModal() {
  const host = $('#rs-modal-host');
  const state = modalState;
  host.innerHTML = buildModal(state.mode, state.booking, state.space, state.slot, state.dateKey);
  const overlay = $('#rs-modal-overlay');
  const form = $('#rs-booking-form');
  $('#rs-modal-close').addEventListener('click', closeModal);
  $('#rs-modal-cancel').addEventListener('click', closeModal);
  overlay.addEventListener('click', event => { if (event.target === overlay && !mutationInProgress) closeModal(); });
  const owner = $('#rs-owner');
  const nicknameRow = $('#rs-nickname-row');
  owner.addEventListener('change', () => nicknameRow.classList.toggle('rs-hidden', owner.value !== OTHER_OWNER));
  const kind = $('#rs-kind');
  kind.addEventListener('change', () => $('#rs-team-note').classList.toggle('rs-hidden', kind.value !== 'team'));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    try { await submitBooking(); }
    catch (error) { console.error('排課送出失敗：', error); showToast('⚠️ 排課送出失敗，請稍後再試'); }
  });
  $('#rs-draft-submit')?.addEventListener('click', () => {
    if (!modalState || mutationInProgress) return;
    modalState.submitAsDraft = true;
    form.requestSubmit();
  });
  $('#rs-delete')?.addEventListener('click', async () => {
    try { await deleteCurrentBooking(); }
    catch (error) { console.error('取消排課失敗：', error); showToast('⚠️ 取消排課失敗，請稍後再試'); }
  });
  overlay.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = $$('button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', form)
      .filter(element => !element.closest('.rs-hidden'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  requestAnimationFrame(() => owner.focus());
}
function closeModal() {
  modalState = null;
  const host = $('#rs-modal-host');
  if (host) host.innerHTML = '';
  const trigger = lastModalTrigger;
  lastModalTrigger = null;
  if (!trigger?.isConnected) return;
  const hadTabIndex = trigger.hasAttribute('tabindex');
  if (!hadTabIndex) {
    trigger.setAttribute('tabindex', '-1');
    trigger.addEventListener('blur', () => trigger.removeAttribute('tabindex'), { once: true });
  }
  trigger.focus({ preventScroll: true });
}
function readModalValues() {
  return { owner: $('#rs-owner').value, nickname: $('#rs-nickname').value.trim(), kind: $('#rs-kind').value, duration: Number($('#rs-duration').value), remark: $('#rs-remark').value.trim() };
}
function makeBooking({ id, dateKey, space, owner, nickname, kind, duration, remark, time, groupId, draft = false }) {
  const result = { id, date: dateKey, space: Number(space), owner, kind, duration: Number(duration), time, createdAt: Date.now() };
  if (draft === true) result.draft = true;
  if (nickname) result.nickname = nickname;
  if (remark) result.remark = remark;
  if (groupId) result.groupId = groupId;
  return result;
}
function targetSpaces(kind, space) { return kind === 'team' ? TEAM_SPACES : [Number(space)]; }
function validateBooking(values, state, existingIds = []) {
  if (!isSchedulableBookingOwner(values.owner)) return '老闆帳號僅供管理，不能被安排課程。';
  if (!isAdmin() && values.owner !== currentUser.name && values.owner !== OTHER_OWNER) return '一般使用者只能安排自己或「其他」教練的課程。';
  if (values.owner === OTHER_OWNER && !values.nickname) return '請輸入「其他」的暱稱。';
  if (values.kind === 'team' && !isTeamSpace(state.space)) return '團課只能安排在二樓自由重量區。';
  if (isAdminSpace(state.space) && values.kind !== 'admin') return '行政時段只能使用行政類型。';
  if (!isAdminSpace(state.space) && values.kind === 'admin') return '一般空間不能使用行政類型。';
  if (!validateRange(state.slot, values.duration)) return '預約時段超過 22:00，請縮短課程或更換時間。';
  const list = allBookingsForDate(state.dateKey);
  const spaces = targetSpaces(values.kind, state.space);
  if (isAdminSpace(state.space)) {
    const adminBookings = list.filter(booking => isAdminSpace(booking.space)).map(booking => {
      const start = timeToSlot(booking.time);
      return { id: booking.id, start, end: start + durationToSlots(booking.duration) };
    });
    if (wouldExceedAdminCapacity(adminBookings, state.slot, state.slot + durationToSlots(values.duration), existingIds)) {
      return `行政時段同一時間最多安排 ${ADMIN_CAPACITY} 位教練。`;
    }
  }
  for (const target of spaces) {
    if (isAdminSpace(target)) continue;
    const conflict = conflictingBooking(list, target, slotToTime(state.slot), values.duration, existingIds, values.owner, values.kind);
    if (conflict) return `${spaceName(target)} 在此時段已有 ${ownerLabel(conflict)} 的排課。`;
  }
  const ownerConflict = conflictingOwner(list, slotToTime(state.slot), values.duration, existingIds, values.owner, values.nickname, values.kind);
  if (ownerConflict) return `${values.owner} 在此時段已有其他排課。`;
  return null;
}
async function submitBooking() {
  const state = modalState;
  if (!state || mutationInProgress) return;
  if (state.mode === 'create' && !canCreateAt(state.space, state.dateKey)) {
    showToast('⚠️ 過去日期的排課只有老闆與史昕銓可以新增。');
    return;
  }
  const values = readModalValues();
  const oldGroup = state.mode === 'edit' ? state.booking.groupId : null;
  const oldRecords = state.mode === 'edit' ? (state.originalRecords || [state.booking]) : [];
  const oldIds = oldRecords.map(b => b.id);
  const error = validateBooking(values, state, oldIds);
  if (error) { showToast(`⚠️ ${error}`); return; }
  const submitAsDraft = state.submitAsDraft === true && isBossManager() && isAdminSpace(state.space);
  const draft = state.mode === 'edit' ? state.booking.draft === true : submitAsDraft;
  const groupId = values.kind === 'team' ? (oldGroup || `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`) : null;
  const spaces = targetSpaces(values.kind, state.space);
  const records = spaces.map(space => makeBooking({
    id: state.mode === 'edit' && oldRecords.find(b => Number(b.space) === space) ? oldRecords.find(b => Number(b.space) === space).id : firebaseId(state.dateKey),
    dateKey: state.dateKey, space, owner: values.owner, nickname: values.owner === OTHER_OWNER ? values.nickname : '', kind: values.kind,
    duration: values.duration, remark: values.remark, time: slotToTime(state.slot), groupId, draft,
  }));
  const mutation = buildDateBookingMutation({
    mode: state.mode,
    originalRecords: oldRecords,
    records,
    requiredTeamSpaces: TEAM_SPACES,
  });
  mutationInProgress = true;
  try {
    const ok = await persistChanges(state.dateKey, mutation);
    if (!ok) return;
    if (state.mode === 'create' && draft !== true) {
      await notifyNewBookings(records, currentUser.name);
      await notifyTeachingAdminOverlap(records, currentUser.name);
    }
    closeModal();
    renderRoot();
    renderCurrentView();
    showToast(state.mode === 'edit' ? '✅ 排課已修改' : (draft ? '📝 預排班已建立（僅老闆可見，尚未上線）' : '✅ 排課已建立'));
  } finally {
    mutationInProgress = false;
  }
}
async function deleteCurrentBooking() {
  const state = modalState;
  if (!state || state.mode !== 'edit' || mutationInProgress) return;
  const button = $('#rs-delete');
  const skipConfirm = state.booking.draft === true;
  if (!skipConfirm && !button?.dataset.confirming) {
    const confirmationToken = String(Date.now());
    button.dataset.confirming = confirmationToken;
    button.textContent = '再次確認';
    button.classList.add('confirming');
    button.disabled = true;
    setTimeout(() => { if (button.isConnected) button.disabled = false; }, 400);
    setTimeout(() => {
      if (!button.isConnected || button.dataset.confirming !== confirmationToken) return;
      delete button.dataset.confirming;
      button.textContent = '取消排課';
      button.classList.remove('confirming');
    }, 5000);
    showToast('請再次按下「再次確認」才會刪除排課');
    return;
  }
  const groupId = state.booking.groupId;
  const originalRecords = state.originalRecords || [state.booking];
  const mutation = buildDateBookingMutation({
    mode: 'delete',
    originalRecords,
    requiredTeamSpaces: TEAM_SPACES,
  });
  mutationInProgress = true;
  try {
    const ok = await persistChanges(state.dateKey, mutation);
    if (!ok) return;
    closeModal();
    showToast(groupId ? '🗑️ 團課已取消' : (state.booking.draft === true ? '🗑️ 預排班已移除' : '🗑️ 排課已取消'));
    renderRoot();
    renderCurrentView();
  } finally {
    mutationInProgress = false;
  }
}
function boot() {
  localStorage.removeItem(SESSION_KEY);
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved && USERS[saved]) currentUser = USERS[saved];
  renderRoot();
  if (currentUser) {
    startIdleTimeout();
    renderCurrentView();
  }
  initDataLayer();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && $('#rs-admin-context-menu')) {
      event.preventDefault();
      closeAdminContextMenu();
      return;
    }
    if (event.key === 'Escape' && adminResizeState) {
      event.preventDefault();
      clearAdminResizeState();
      showToast('已取消行政時間調整');
      return;
    }
    if (event.key === 'Escape' && modalState && !mutationInProgress) closeModal();
  });
  document.addEventListener('pointerdown', event => {
    const menu = $('#rs-admin-context-menu');
    if (menu && !menu.contains(event.target)) closeAdminContextMenu();
  });
  document.addEventListener('scroll', closeAdminContextMenu, true);
  window.addEventListener('blur', closeAdminContextMenu);
}

boot();
