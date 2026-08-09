import './schedule-redesign.css';

const ROOT_PATH = 'scheduleV2Bookings';
const FALLBACK_KEY = 'relife_schedule_v2_bookings';
const SESSION_KEY = 'relife_schedule_user';
const PASSWORDS = { admin: '0000', '高芷妍': '0000' };
const USERS = { admin: { name: 'admin', role: 'admin' }, '高芷妍': { name: '高芷妍', role: 'user' } };
const OTHER_OWNER = '其他';
const TEAM_SPACES = [7, 8, 9];
const SPACES = 9;
const SPACE_NAMES = ['行政時段', '一樓槓座', '一樓史密斯', '一樓cable', '一樓機動空間', '二樓槓座', '二樓自由重量(1)', '二樓自由重量(2)', '二樓機動空間'];
const OPEN_HOUR = 9;
const CLOSE_HOUR = 22;
const SLOT_MINUTES = 15;
const SLOTS_PER_DAY = (CLOSE_HOUR - OPEN_HOUR) * 60 / SLOT_MINUTES;
const ADMIN_DURATIONS = [30, 60, 90, 120, 150, 180, 210, 240];
const COACH_DURATIONS = [75, 90];
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:09|1\d|2[01]):(?:00|15|30|45)$/;

let db = null;
let firebaseApi = null;
let useFallback = false;
let dataStatus = 'loading';
let dataErrorMessage = '';
let rawBookings = {};
let currentUser = null;
let currentDate = new Date();
let currentView = 'month';
let selectedDateKey = null;
let modalState = null;
let lastModalTrigger = null;
let toastTimer = null;
let mutationInProgress = false;

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
function courseLabel(booking) { return booking.kind === 'team' ? '團課' : (booking.space === 1 ? '行政' : '教練課'); }
function isToday(date) { const now = new Date(); return fmtDate(now) === fmtDate(date); }
function isAdmin() { return currentUser?.role === 'admin'; }
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
      const space = Number(item.space);
      const duration = Number(item.duration);
      const owner = typeof item.owner === 'string' ? item.owner.trim() : '';
      const time = typeof item.time === 'string' ? item.time.trim() : '';
      const kind = ['admin', 'coach', 'team'].includes(item.kind) ? item.kind : (space === 1 ? 'admin' : 'coach');
      const slot = timeToSlot(time);
      const valid = id
        && Number.isInteger(space) && space >= 1 && space <= SPACES
        && owner
        && TIME_PATTERN.test(time)
        && Number.isFinite(duration) && duration > 0 && duration % SLOT_MINUTES === 0
        && Number.isInteger(slot) && validateRange(slot, duration)
        && (kind !== 'team' || isTeamSpace(space));
      if (!valid) { ignoredCount++; continue; }
      const normalized = { ...item, id, date, space, owner, kind, time, duration };
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
function bookingsForDate(dateKey) { return rawBookings[dateKey] || []; }
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
function ownerChoices() { return isAdmin() ? ['admin', '高芷妍', OTHER_OWNER] : ['高芷妍', OTHER_OWNER]; }
function canCreateAt(space) { return isDataReady() && (isAdmin() || !isAdminSpace(space)); }
function canEditBooking(booking) {
  if (!currentUser || !isDataReady()) return false;
  if (isAdmin()) return true;
  if (isAdminSpace(booking.space)) return false;
  return booking.owner === '高芷妍' || booking.owner === OTHER_OWNER;
}
function canDeleteBooking(booking) { return canEditBooking(booking); }
function canUseKind(kind, space) { return kind !== 'team' || isTeamSpace(space); }
function overlaps(startA, durationA, startB, durationB) {
  const a1 = timeToSlot(startA), a2 = a1 + durationToSlots(durationA);
  const b1 = timeToSlot(startB), b2 = b1 + durationToSlots(durationB);
  return a1 < b2 && a2 > b1;
}
function conflictingBooking(list, space, time, duration, excludeIds = [], owner, kind) {
  if (owner === OTHER_OWNER) return null;
  return list.find(b => {
    if (!b || excludeIds.includes(b.id)) return false;
    if (Number(b.space) !== Number(space)) return false;
    if (b.owner === OTHER_OWNER) return false;
    if (kind === 'team' && b.kind === 'team' && b.groupId && excludeIds.some(id => id === b.id)) return false;
    return overlaps(time, duration, b.time, b.duration);
  }) || null;
}
function conflictingOwner(list, time, duration, excludeIds = [], owner, kind) {
  if (owner === OTHER_OWNER) return null;
  return list.find(b => {
    if (!b || excludeIds.includes(b.id) || b.owner === OTHER_OWNER) return false;
    if (b.owner !== owner) return false;
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
  if (config && config.databaseURL) {
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
  if (useFallback) {
    try { rawBookings = normalizeBookings(JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}')); }
    catch { rawBookings = {}; }
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
    });
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
  }
}
async function persistChanges(dateKey, removeIds, additions, replacements = []) {
  if (!isDataReady()) {
    showToast('⚠️ 排課資料尚未同步完成，請稍後再試');
    return false;
  }
  if (useFallback) {
    const list = bookingsForDate(dateKey).filter(b => !removeIds.includes(b.id));
    const replacementIds = new Set(replacements.map(item => item.id));
    const kept = list.filter(b => !replacementIds.has(b.id));
    const nextBookings = { ...rawBookings, [dateKey]: [...kept, ...replacements, ...additions] };
    if (!nextBookings[dateKey].length) delete nextBookings[dateKey];
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(nextBookings));
      rawBookings = nextBookings;
      return true;
    } catch (error) {
      console.error('本機排課資料儲存失敗：', error);
      showToast('⚠️ 儲存失敗，請確認瀏覽器允許本機儲存');
      return false;
    }
  }
  const changes = {};
  removeIds.forEach(id => { changes[`${ROOT_PATH}/${dateKey}/${id}`] = null; });
  replacements.forEach(item => { changes[`${ROOT_PATH}/${dateKey}/${item.id}`] = item; });
  additions.forEach(item => { changes[`${ROOT_PATH}/${dateKey}/${item.id}`] = item; });
  try {
    await firebaseApi.update(firebaseApi.ref(db), changes);
    return true;
  } catch (error) {
    console.error('Firebase 寫入失敗：', error);
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
    <div class="rs-field"><label for="rs-login-user">使用者名稱</label><select id="rs-login-user"><option value="admin">admin</option><option value="高芷妍">高芷妍</option></select></div>
    <div class="rs-field"><label for="rs-login-password">密碼</label><input id="rs-login-password" type="password" inputmode="numeric" autocomplete="current-password" autofocus></div>
    <div class="rs-error" id="rs-login-error" role="alert" aria-live="polite">${escapeHtml(dataErrorMessage)}</div>
    <button class="rs-primary" type="submit">登入</button>
  </form></div>`;
  $('#rs-login-form').addEventListener('submit', event => {
    event.preventDefault();
    const user = $('#rs-login-user').value;
    const password = $('#rs-login-password').value;
    if (PASSWORDS[user] !== password) {
      $('#rs-login-error').textContent = '密碼錯誤，請重新輸入。';
      $('#rs-login-password').value = '';
      return;
    }
    currentUser = USERS[user];
    localStorage.setItem(SESSION_KEY, user);
    currentView = 'month';
    currentDate = new Date();
    renderRoot();
    renderCurrentView();
  });
}
function renderShell(root) {
  root.innerHTML = `<div class="rs-app-shell">
    <header class="rs-header">
      <div class="rs-header-brand">RELIFE Fitness · 排課系統</div>
      <div class="rs-header-user"><span>${escapeHtml(currentUser.name)}</span><span class="rs-role-pill">${currentUser.role === 'admin' ? '管理員' : '一般使用者'}</span></div>
      <div class="rs-header-actions">
        <button type="button" class="rs-mobile-view-toggle rs-nav-btn active" id="rs-mobile-view-toggle">${currentView === 'month' ? '查看當日預約' : '返回月檢視'}</button>
        <button type="button" class="rs-nav-btn rs-desktop-only ${currentView === 'month' ? 'active' : ''}" id="rs-month-btn" aria-pressed="${currentView === 'month'}">我的月檢視</button>
        <button type="button" class="rs-nav-btn rs-desktop-only ${currentView === 'day' ? 'active' : ''}" id="rs-day-btn" aria-pressed="${currentView === 'day'}">全館日檢視</button>
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
  $('#rs-logout').addEventListener('click', logout);
}
function logout() {
  currentUser = null;
  localStorage.removeItem(SESSION_KEY);
  modalState = null;
  renderRoot();
}
function renderCurrentView() {
  if (!isLoggedIn()) return;
  const main = $('#rs-main');
  if (!main) { renderRoot(); return; }
  if (dataStatus === 'error') {
    main.innerHTML = `<div class="rs-permission-note" role="alert">${escapeHtml(dataErrorMessage)}</div>`;
    return;
  }
  if (currentView === 'month') renderMonthView(main); else renderDayView(main);
}
function renderToolbar(title, subtitle) {
  return `<div class="rs-toolbar"><div><div class="rs-toolbar-title">${title}</div><div class="rs-toolbar-sub">${subtitle}</div></div><div class="rs-date-nav"><button type="button" data-nav="-1">◀ 上一個</button><span class="rs-date-title">${currentView === 'month' ? `${currentDate.getFullYear()}年${currentDate.getMonth() + 1}月` : formatDateCN(currentDate)}</span><button type="button" data-nav="1">下一個 ▶</button><button type="button" data-today="1">今天</button></div></div>`;
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
  const list = bookingsForDate(dateKey).filter(b => b.owner === currentUser.name);
  return uniqueTeamBookings(list).sort((a, b) => timeToSlot(a.time) - timeToSlot(b.time));
}
function renderMonthView(main) {
  const year = currentDate.getFullYear(), month = currentDate.getMonth();
  const first = new Date(year, month, 1), last = new Date(year, month + 1, 0);
  let html = renderToolbar('我的月檢視', `${escapeHtml(currentUser.name)} 的行政排班與教練課程`);
  html += '<div class="rs-month-grid">' + ['日', '一', '二', '三', '四', '五', '六'].map(day => `<div class="rs-weekday">${day}</div>`).join('') + '</div>';
  html += '<div class="rs-month-grid" id="rs-month-days">';
  for (let i = first.getDay() - 1; i >= 0; i--) html += monthDayHtml(new Date(year, month, -i), true);
  for (let day = 1; day <= last.getDate(); day++) html += monthDayHtml(new Date(year, month, day), false);
  const cells = first.getDay() + last.getDate();
  for (let day = 1; day <= (7 - cells % 7) % 7; day++) html += monthDayHtml(new Date(year, month + 1, day), true);
  html += '</div><div class="rs-stats" id="rs-stats"></div>';
  main.innerHTML = html;
  attachDateNav(main);
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
  const content = items.length ? items.map(b => `<div class="rs-day-item ${b.kind === 'team' ? 'team' : (isAdminSpace(b.space) ? 'admin' : 'coach')} ${b.owner === '高芷妍' ? 'high' : ''}"><strong>${courseLabel(b)}：</strong>${escapeHtml(b.time)}–${escapeHtml(endTime(b.time, b.duration))}${b.remark ? `<br>📝 ${escapeHtml(b.remark)}` : ''}</div>`).join('') : (!other ? '<div class="rs-day-empty">尚無排課</div>' : '');
  return `<div class="${classes.join(' ')}" data-date="${key}"><div class="rs-day-number">${date.getDate()}</div>${content}</div>`;
}
function statsForOwner(owner, year, month) {
  let adminMinutes = 0, coachClasses = 0, teamClasses = 0;
  const groups = new Set();
  const last = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= last; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`;
    for (const booking of bookingsForDate(key)) {
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
  const owners = isAdmin() ? ['admin', '高芷妍'] : [currentUser.name];
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
function renderDayView(main) {
  const dateKey = fmtDate(currentDate);
  const dayBookings = allBookingsForDate(dateKey);
  let html = renderToolbar('全館日檢視', `${formatDateCN(currentDate)} · 所有人排課總表`);
  html += `<div class="rs-permission-note">${isAdmin() ? '管理員：可編輯所有排課。' : '一般使用者：可編輯教練課與「其他」課程；行政時段僅管理員可編輯。'}</div>`;
  html += '<div class="rs-table-wrap"><table class="rs-day-table"><thead><tr><th class="time">時間</th>' + SPACE_NAMES.map(name => `<th class="resource">${name}</th>`).join('') + '</tr></thead><tbody>';
  for (let slot = 0; slot < SLOTS_PER_DAY; slot++) {
    html += `<tr class="${slot % 4 === 0 ? 'hour' : ''}"><td class="time">${slotToTime(slot)}</td>`;
    for (let space = 1; space <= SPACES; space++) {
      const booking = findBookingAtSlot(dayBookings, space, slot);
      if (booking && timeToSlot(booking.time) !== slot) continue;
      if (!booking) {
        const clickable = canCreateAt(space);
        html += `<td class="rs-slot empty" ${clickable ? `data-create-space="${space}" data-create-slot="${slot}"` : 'title="只有管理員可以編輯行政時段"'}></td>`;
        continue;
      }
      const display = `${escapeHtml(ownerLabel(booking))}${booking.kind === 'team' ? '（團課）' : ''}`;
      const remark = booking.remark ? `<div class="rs-remark">📝 ${escapeHtml(booking.remark)}</div>` : '';
      html += `<td class="rs-slot booked ${booking.kind === 'team' ? 'team' : (isAdminSpace(booking.space) ? 'admin' : 'coach')} ${booking.owner === '高芷妍' ? 'high' : ''}" rowspan="${durationToSlots(booking.duration)}" data-booking-id="${escapeHtml(booking.id)}"><div>${display}</div><small>${escapeHtml(booking.time)}–${escapeHtml(endTime(booking.time, booking.duration))}</small>${remark}</td>`;
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
}
function buildModal(mode, booking, space, slot, dateKey) {
  const editing = mode === 'edit';
  const owner = editing ? booking.owner : (isAdmin() ? 'admin' : '高芷妍');
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
  return `<div class="rs-modal-overlay" id="rs-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rs-modal-title"><form class="rs-modal" id="rs-booking-form">
    <button type="button" class="rs-modal-close" id="rs-modal-close" aria-label="關閉排課視窗">✕</button><h2 id="rs-modal-title">${title}</h2><div class="rs-modal-sub">${escapeHtml(info)}</div>
    ${editing ? `<div class="rs-info-box">📅 ${formatDateCN(parseDate(dateKey))}<br>🏠 ${spaceName(booking.space)}<br>👤 ${escapeHtml(ownerLabel(booking))}</div>` : ''}
    <label for="rs-owner">使用者</label><select id="rs-owner">${owners.map(item => `<option value="${escapeHtml(item)}" ${item === owner ? 'selected' : ''}>${escapeHtml(item)}</option>`).join('')}</select>
    <div id="rs-nickname-row" class="${owner === OTHER_OWNER ? '' : 'rs-hidden'}"><label for="rs-nickname">其他暱稱</label><input id="rs-nickname" value="${escapeHtml(editing ? (booking.nickname || '') : '')}" placeholder="例如：小明"></div>
    <label for="rs-kind">課程類型</label><select id="rs-kind" ${canChangeKind ? '' : 'disabled'}>${kindOptions}</select>
    <div id="rs-team-note" class="rs-permission-note ${kind === 'team' ? '' : 'rs-hidden'}">團課會同時佔用二樓自由重量(1)、二樓自由重量(2)、二樓機動空間。</div>
    <label for="rs-duration">課程時長</label><select id="rs-duration">${durations.map(item => `<option value="${item}" ${item === duration ? 'selected' : ''}>${isAdminSpace(space) ? `${item / 60} 小時` : `${item} 分鐘`}</option>`).join('')}</select>
    <label for="rs-remark">📝 備註</label><input id="rs-remark" value="${escapeHtml(editing ? (booking.remark || '') : '')}" placeholder="選填，例如：體驗課、調整姿勢">
    <div class="rs-modal-actions"><button type="button" class="rs-secondary" id="rs-modal-cancel">關閉</button>${editing && canDeleteBooking(booking) ? '<button type="button" class="rs-danger-btn" id="rs-delete">取消排課</button>' : ''}<button type="submit" class="rs-primary">${editing ? '確認修改' : '確認預約'}</button></div>
  </form></div>`;
}
function openCreateModal(space, slot, dateKey, triggerElement = null) {
  if (!canCreateAt(space)) { showToast('⚠️ 行政時段只有管理員可以編輯'); return; }
  lastModalTrigger = triggerElement || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  modalState = { mode: 'create', space, slot, dateKey };
  mountModal();
}
function openEditModal(booking, dateKey, triggerElement = null) {
  if (!canEditBooking(booking)) { showToast('🔒 目前帳號沒有編輯這筆排課的權限'); return; }
  lastModalTrigger = triggerElement || (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  modalState = { mode: 'edit', booking, space: Number(booking.space), slot: timeToSlot(booking.time), dateKey };
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
function makeBooking({ id, dateKey, space, owner, nickname, kind, duration, remark, time, groupId }) {
  const result = { id, date: dateKey, space: Number(space), owner, kind, duration: Number(duration), time, createdAt: Date.now() };
  if (nickname) result.nickname = nickname;
  if (remark) result.remark = remark;
  if (groupId) result.groupId = groupId;
  return result;
}
function targetSpaces(kind, space) { return kind === 'team' ? TEAM_SPACES : [Number(space)]; }
function validateBooking(values, state, existingIds = []) {
  if (values.owner === OTHER_OWNER && !values.nickname) return '請輸入「其他」的暱稱。';
  if (values.kind === 'team' && !isTeamSpace(state.space)) return '團課只能安排在二樓自由重量區。';
  if (isAdminSpace(state.space) && values.kind !== 'admin') return '行政時段只能使用行政類型。';
  if (!isAdminSpace(state.space) && values.kind === 'admin') return '一般空間不能使用行政類型。';
  if (!validateRange(state.slot, values.duration)) return '預約時段超過 22:00，請縮短課程或更換時間。';
  const list = allBookingsForDate(state.dateKey);
  const spaces = targetSpaces(values.kind, state.space);
  for (const target of spaces) {
    const conflict = conflictingBooking(list, target, slotToTime(state.slot), values.duration, existingIds, values.owner, values.kind);
    if (conflict) return `${spaceName(target)} 在此時段已有 ${ownerLabel(conflict)} 的排課。`;
  }
  const ownerConflict = conflictingOwner(list, slotToTime(state.slot), values.duration, existingIds, values.owner, values.kind);
  if (ownerConflict) return `${values.owner} 在此時段已有其他排課。`;
  return null;
}
async function submitBooking() {
  const state = modalState;
  if (!state || mutationInProgress) return;
  const values = readModalValues();
  const oldGroup = state.mode === 'edit' ? state.booking.groupId : null;
  const oldRecords = state.mode === 'edit' && oldGroup ? allBookingsForDate(state.dateKey).filter(b => b.groupId === oldGroup) : (state.mode === 'edit' ? [state.booking] : []);
  const oldIds = oldRecords.map(b => b.id);
  const error = validateBooking(values, state, oldIds);
  if (error) { showToast(`⚠️ ${error}`); return; }
  const groupId = values.kind === 'team' ? (oldGroup || `team_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`) : null;
  const spaces = targetSpaces(values.kind, state.space);
  const records = spaces.map(space => makeBooking({
    id: state.mode === 'edit' && oldRecords.find(b => Number(b.space) === space) ? oldRecords.find(b => Number(b.space) === space).id : firebaseId(state.dateKey),
    dateKey: state.dateKey, space, owner: values.owner, nickname: values.owner === OTHER_OWNER ? values.nickname : '', kind: values.kind,
    duration: values.duration, remark: values.remark, time: slotToTime(state.slot), groupId
  }));
  mutationInProgress = true;
  try {
    const ok = await persistChanges(state.dateKey, oldIds, [], records);
    if (!ok) return;
    closeModal();
    showToast(state.mode === 'edit' ? '✅ 排課已修改' : '✅ 排課已建立');
    renderCurrentView();
  } finally {
    mutationInProgress = false;
  }
}
async function deleteCurrentBooking() {
  const state = modalState;
  if (!state || state.mode !== 'edit' || mutationInProgress) return;
  const button = $('#rs-delete');
  if (!button?.dataset.confirming) {
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
  const removeIds = groupId ? allBookingsForDate(state.dateKey).filter(b => b.groupId === groupId).map(b => b.id) : [state.booking.id];
  mutationInProgress = true;
  try {
    const ok = await persistChanges(state.dateKey, removeIds, []);
    if (!ok) return;
    closeModal();
    showToast(groupId ? '🗑️ 團課已取消' : '🗑️ 排課已取消');
    renderCurrentView();
  } finally {
    mutationInProgress = false;
  }
}
function boot() {
  const saved = localStorage.getItem(SESSION_KEY);
  if (saved && USERS[saved]) currentUser = USERS[saved];
  renderRoot();
  if (currentUser) renderCurrentView();
  initDataLayer();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modalState && !mutationInProgress) closeModal();
  });
}

boot();
