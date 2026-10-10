import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { isClosedDay } from '../src/schedule-closed-days.js';

const source = readFileSync(new URL('../src/schedule-redesign.js', import.meta.url), 'utf8');
const start = source.indexOf('function statsForOwner(owner, year, month) {');
const end = source.indexOf('function renderStats(', start);
assert.ok(start >= 0 && end > start, 'Locate the actual production monthly statistics function');
function stats(bookings, closedDays = {}, owner = '洪琇捷') {
  const context = {
    pad: value => String(value).padStart(2, '0'),
    bookingsForDate: key => bookings[key] || [],
    isDateClosed: key => isClosedDay(closedDays, key),
    isAdminSpace: space => Number(space) === 1,
    owner,
  };
  vm.runInNewContext(`${source.slice(start, end)}\nresult = statsForOwner(owner, 2026, 8);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

test('九月休館日行政排班不計入統計：40 小時應為 32 小時', () => {
  const dates = [14, 15, 17, 18, 19, 21, 22, 24, 26, 29];
  const bookings = Object.fromEntries(dates.map(day => [`2026-09-${day}`, [{ id: String(day), owner: '洪琇捷', space: 1, kind: 'admin', duration: 240 }]]));
  assert.equal(stats(bookings, { '2026-09-17': true, '2026-09-26': true }).adminHours, 32);
});

test('休館日全部類型排課不計入行政、教練與團課統計', () => {
  const bookings = {
    '2026-09-17': [
      { id: 'a', owner: '洪琇捷', space: 1, kind: 'admin', duration: 240 },
      { id: 'c', owner: '洪琇捷', space: 2, kind: 'coach', duration: 60 },
      { id: 't', owner: '洪琇捷', space: 7, kind: 'team', duration: 75, groupId: 'closed-team' },
    ],
  };
  assert.deepEqual(stats(bookings, { '2026-09-17': true }), { adminHours: 0, coachClasses: 0, teamClasses: 0 });
});

test('正常營業日保留行政與教練堂數、團課三場地只計一次、草稿排除', () => {
  const bookings = {
    '2026-09-14': [
      { id: 'a', owner: '洪琇捷', space: 1, kind: 'admin', duration: 240 },
      { id: 'c', owner: '洪琇捷', space: 2, kind: 'coach', duration: 60 },
      ...[7, 8, 9].map(space => ({ id: `t-${space}`, owner: '洪琇捷', space, kind: 'team', duration: 75, groupId: 'open-team' })),
      { id: 'draft', owner: '洪琇捷', space: 1, kind: 'admin', duration: 240, draft: true },
      { id: 'other', owner: '史昕銓', space: 1, kind: 'admin', duration: 240 },
    ],
    '2026-10-01': [{ id: 'next-month', owner: '洪琇捷', space: 1, kind: 'admin', duration: 240 }],
  };
  assert.deepEqual(stats(bookings), { adminHours: 4, coachClasses: 1, teamClasses: 1 });
});
