import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ADMIN_DURATIONS,
  keyboardAdminResizeCommand,
  keyboardTargetAdminSlot,
  pointerYToAdminSlot,
  resizeAdminRange,
} from '../src/admin-schedule-resize.js';

test('拖曳行政卡片下邊框會以 15 分鐘格調整結束時間', () => {
  assert.deepEqual(
    resizeAdminRange({ start: 4, end: 8, edge: 'end', targetSlot: 11, totalSlots: 52 }),
    { start: 4, end: 11 },
  );
});

test('拖曳行政卡片上邊框會調整開始時間並保留結束時間', () => {
  assert.deepEqual(
    resizeAdminRange({ start: 8, end: 16, edge: 'start', targetSlot: 5, totalSlots: 52 }),
    { start: 5, end: 16 },
  );
});

test('拖曳邊框會限制行政時段為 30 至 240 分鐘且不超出營業時間', () => {
  assert.deepEqual(
    resizeAdminRange({ start: 4, end: 12, edge: 'end', targetSlot: 5, totalSlots: 52, maxSlots: 16 }),
    { start: 4, end: 6 },
  );
  assert.deepEqual(
    resizeAdminRange({ start: 4, end: 12, edge: 'end', targetSlot: 40, totalSlots: 52, maxSlots: 16 }),
    { start: 4, end: 20 },
  );
  assert.deepEqual(
    resizeAdminRange({ start: 40, end: 48, edge: 'end', targetSlot: 60, totalSlots: 52, maxSlots: 16 }),
    { start: 40, end: 52 },
  );
  assert.deepEqual(
    resizeAdminRange({ start: 20, end: 28, edge: 'start', targetSlot: -4, totalSlots: 52, maxSlots: 16 }),
    { start: 12, end: 28 },
  );
  assert.deepEqual(
    resizeAdminRange({ start: 20, end: 28, edge: 'start', targetSlot: 27, totalSlots: 52, maxSlots: 16 }),
    { start: 26, end: 28 },
  );
});

test('滑鼠或手指位置會依行政時間軸換算並吸附到最近的 15 分鐘格', () => {
  assert.equal(pointerYToAdminSlot({ clientY: 249, top: 100, height: 520, totalSlots: 52 }), 15);
  assert.equal(pointerYToAdminSlot({ clientY: 20, top: 100, height: 520, totalSlots: 52 }), 0);
  assert.equal(pointerYToAdminSlot({ clientY: 700, top: 100, height: 520, totalSlots: 52 }), 52);
});

test('行政時長選單包含 30 至 240 分鐘之間的每個 15 分鐘選項', () => {
  assert.deepEqual(ADMIN_DURATIONS, [30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240]);
});

test('方向鍵會把目前操作的行政邊框前後移動一個 15 分鐘格', () => {
  assert.equal(keyboardTargetAdminSlot({ edge: 'start', start: 4, end: 8, key: 'ArrowUp' }), 3);
  assert.equal(keyboardTargetAdminSlot({ edge: 'start', start: 4, end: 8, key: 'ArrowDown' }), 5);
  assert.equal(keyboardTargetAdminSlot({ edge: 'end', start: 4, end: 8, key: 'ArrowUp' }), 7);
  assert.equal(keyboardTargetAdminSlot({ edge: 'end', start: 4, end: 8, key: 'ArrowDown' }), 9);
  assert.equal(keyboardTargetAdminSlot({ edge: 'end', start: 4, end: 8, key: 'Enter' }), null);
});

test('鍵盤方向鍵只更新預覽，Enter 確認而 Escape 回復原範圍', () => {
  const originalRange = { start: 4, end: 8 };
  const preview = keyboardAdminResizeCommand({
    edge: 'end', key: 'ArrowDown', range: originalRange, originalRange, totalSlots: 52,
  });

  assert.deepEqual(preview, { action: 'preview', range: { start: 4, end: 9 } });
  assert.deepEqual(keyboardAdminResizeCommand({
    edge: 'end', key: 'Enter', range: preview.range, originalRange, totalSlots: 52,
  }), { action: 'commit', range: { start: 4, end: 9 } });
  assert.deepEqual(keyboardAdminResizeCommand({
    edge: 'end', key: ' ', range: preview.range, originalRange, totalSlots: 52,
  }), { action: 'commit', range: { start: 4, end: 9 } });
  assert.deepEqual(keyboardAdminResizeCommand({
    edge: 'end', key: 'Escape', range: preview.range, originalRange, totalSlots: 52,
  }), { action: 'cancel', range: originalRange });
  assert.equal(keyboardAdminResizeCommand({
    edge: 'end', key: 'Tab', range: preview.range, originalRange, totalSlots: 52,
  }), null);
});
