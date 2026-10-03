import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingDisplayEndTime } from '../src/schedule-booking-rules.js';

test('day-card end time includes the separate 0/5/10/15 minute buffer', () => {
  for (const bufferMinutes of [0, 5, 10, 15]) {
    const booking = { time: '14:00', duration: 60, bufferMinutes };
    assert.equal(bookingDisplayEndTime(booking), `15:${String(bufferMinutes).padStart(2, '0')}`);
  }
});

test('day-card end time crosses an hour and does not double count legacy duration', () => {
  assert.equal(bookingDisplayEndTime({ time: '14:55', duration: 60, bufferMinutes: 15 }), '16:10');
  assert.equal(bookingDisplayEndTime({ time: '14:00', duration: 75 }), '15:15');
  assert.equal(bookingDisplayEndTime({ time: '14:00', duration: 90 }), '15:30');
});
