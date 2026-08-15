export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * 建立閒置自動登出計時器。
 * 任何活動呼叫 reset() 後重新計算 30 分鐘；連續 idle 超過 timeoutMs 觸發 onIdle 一次。
 * 透過 now/setTimer/clearTimer 注入以便測試。
 */
export function createIdleTimeout({
  timeoutMs = IDLE_TIMEOUT_MS,
  onIdle,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof onIdle !== 'function') throw new TypeError('createIdleTimeout: onIdle 必須是函式');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new TypeError('createIdleTimeout: timeoutMs 必須是正整數');

  let timerId = null;
  let lastActivityAt = now();
  let fired = false;

  function fire() {
    if (fired) return;
    fired = true;
    timerId = null;
    onIdle();
  }

  function reset() {
    if (fired) return;
    lastActivityAt = now();
    if (timerId !== null) clearTimer(timerId);
    timerId = setTimer(fire, timeoutMs);
  }

  function dispose() {
    if (timerId !== null) { clearTimer(timerId); timerId = null; }
    fired = true;
  }

  function idleFor() { return now() - lastActivityAt; }

  reset();
  return { reset, dispose, idleFor };
}
