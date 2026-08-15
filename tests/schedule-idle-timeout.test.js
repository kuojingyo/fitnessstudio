import test from 'node:test';
import assert from 'node:assert/strict';

import { createIdleTimeout, IDLE_TIMEOUT_MS } from '../src/schedule-idle-timeout.js';

function fakeClock() {
  let nowMs = 0;
  let sequence = 0;
  const timers = new Map();
  return {
    now: () => nowMs,
    setTimer: (fn, ms) => {
      const id = ++sequence;
      timers.set(id, { fn, at: nowMs + ms });
      return id;
    },
    clearTimer: (id) => { timers.delete(id); },
    advance(ms) {
      nowMs += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= nowMs) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
    activeCount: () => timers.size,
  };
}

test('閒置逾時預設為 30 分鐘', () => {
  assert.equal(IDLE_TIMEOUT_MS, 30 * 60 * 1000);
});

test('連續 30 分鐘未操作會觸發自動登出', () => {
  const clock = fakeClock();
  let fired = 0;
  createIdleTimeout({ onIdle: () => { fired++; }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  clock.advance(29 * 60 * 1000);
  assert.equal(fired, 0, '未滿 30 分鐘不得觸發');

  clock.advance(60 * 1000);
  assert.equal(fired, 1, '滿 30 分鐘必須觸發一次');
});

test('任何活動都會把計時器重新歸零', () => {
  const clock = fakeClock();
  let fired = 0;
  const idle = createIdleTimeout({ onIdle: () => { fired++; }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  clock.advance(20 * 60 * 1000);
  idle.reset();

  clock.advance(20 * 60 * 1000);
  assert.equal(fired, 0, 'reset 後未滿 30 分鐘不得觸發');

  clock.advance(10 * 60 * 1000);
  assert.equal(fired, 1);
});

test('onIdle 只觸發一次，之後 reset 不再排程', () => {
  const clock = fakeClock();
  let fired = 0;
  const idle = createIdleTimeout({ onIdle: () => { fired++; }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  clock.advance(30 * 60 * 1000 + 500);
  idle.reset();
  clock.advance(30 * 60 * 1000);

  assert.equal(fired, 1);
});

test('dispose 後不再觸發自動登出', () => {
  const clock = fakeClock();
  let fired = 0;
  const idle = createIdleTimeout({ onIdle: () => { fired++; }, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  idle.dispose();
  clock.advance(60 * 60 * 1000);

  assert.equal(fired, 0);
  assert.equal(clock.activeCount(), 0, 'dispose 必須清除計時器');
});

test('idleFor 回報距離上次活動的毫秒數', () => {
  const clock = fakeClock();
  const idle = createIdleTimeout({ onIdle: () => {}, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });

  clock.advance(5 * 60 * 1000);
  assert.equal(idle.idleFor(), 5 * 60 * 1000);

  idle.reset();
  clock.advance(1000);
  assert.equal(idle.idleFor(), 1000);
});

test('缺少 onIdle 或非法 timeoutMs 必須直接拒絕', () => {
  assert.throws(() => createIdleTimeout({}), TypeError);
  assert.throws(() => createIdleTimeout({ onIdle: () => {}, timeoutMs: 0 }), TypeError);
  assert.throws(() => createIdleTimeout({ onIdle: () => {}, timeoutMs: -1 }), TypeError);
  assert.throws(() => createIdleTimeout({ onIdle: () => {}, timeoutMs: 1.5 }), TypeError);
});
