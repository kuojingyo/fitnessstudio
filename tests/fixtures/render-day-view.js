import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildDayBookingIndex } from '../../src/schedule-day-index.js';
import { bookingDisplayEndTime, dayBookingRowspan, timeToMinute } from '../../src/schedule-booking-rules.js';

const source = readFileSync(new URL('../../src/schedule-redesign.js', import.meta.url), 'utf8');
const start = source.indexOf('function renderDayView(main) {');
const end = source.indexOf('function buildModal(', start);
if (start < 0 || end < 0) throw new Error('Day renderer fixture could not locate the production renderer');
const renderer = source.slice(start, end);
const constantNames = ['SPACES', 'OPEN_HOUR', 'CLOSE_HOUR', 'SLOT_MINUTES', 'SLOT_ROW_HEIGHT_PX', 'PX_PER_MINUTE', 'SLOTS_PER_DAY', 'GRID_END_HOUR', 'GRID_SLOTS_PER_DAY'];
const constants = {};
for (const name of constantNames) {
  const match = source.match(new RegExp(`^const ${name} = ([^;]+);`, 'm'));
  if (!match) throw new Error(`Missing day renderer constant: ${name}`);
  constants[name] = vm.runInNewContext(`(${match[1]})`, constants);
}

// Execute only the real day renderer. No login, Firebase, storage, or mutations.
export function renderDayViewFixture(bookings) {
  const main = { innerHTML: '' };
  const noop = () => {};
  const context = {
    ...constants,
    main,
    currentDate: new Date('2026-10-07T12:00:00Z'),
    SPACE_NAMES: Array.from({ length: constants.SPACES }, (_, i) => `Space ${i + 1}`),
    ADMIN_CAPACITY: 3,
    fmtDate: () => '2026-10-07',
    formatDateCN: () => 'Synthetic fixture',
    allBookingsForDate: () => bookings,
    buildDayBookingIndex,
    dayBookingRowspan,
    timeToMinute,
    bookingDisplayEndTime,
    isDateClosed: () => false,
    isBossManager: () => false,
    isAdmin: () => false,
    isAdminSpace: space => Number(space) === 1,
    renderToolbar: () => '<h1>Synthetic schedule fixture</h1>',
    renderAdminTimeline: () => `<div class="rs-admin-timeline" style="height:${constants.GRID_SLOTS_PER_DAY * constants.SLOT_ROW_HEIGHT_PX}px"></div>`,
    slotToTime: slot => {
      const minute = constants.OPEN_HOUR * 60 + slot * constants.SLOT_MINUTES;
      return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    },
    canCreateAt: () => false,
    ownerLabel: booking => booking.owner || 'Sample',
    ownerColorClass: () => 'shi',
    creatorNoteHtml: () => '',
    escapeHtml: value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])),
    $: () => null,
    $$: () => [],
    attachDateNav: noop,
    attachAdminResize: noop,
    attachAdminClipboard: noop,
    attachCoachClipboard: noop,
    attachBookingDrag: noop,
  };
  vm.runInNewContext(`${renderer}\nrenderDayView(main);`, context, { timeout: 1000 });
  return main.innerHTML;
}

export function readRenderedCards(html) {
  return [...html.matchAll(/<td class="rs-slot booked\b[\s\S]*?<\/td>/g)].map(([markup]) => {
    const tail = markup.match(/class="rs-card-tail" style="([^"]+)"/);
    const property = name => tail?.[1].match(new RegExp(`(?:^|;)${name}:([\\d.]+)px`))?.[1];
    return {
      id: markup.match(/data-booking-id="([^"]+)"/)[1],
      rowspan: Number(markup.match(/rowspan="(\d+)"/)[1]),
      spacerHeight: Number(markup.match(/class="rs-card-spacer" style="height:([\d.]+)px"/)[1]),
      mainHeight: Number(markup.match(/class="rs-card-main" style="height:([\d.]+)px"/)[1]),
      tail: tail ? { top: Number(property('top')), height: Number(property('height')) } : null,
      markup,
    };
  });
}
