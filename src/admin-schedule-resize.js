function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export const ADMIN_DURATIONS = Array.from({ length: 15 }, (_, index) => 30 + index * 15);

export function pointerYToAdminSlot({ clientY, top, height, totalSlots }) {
  if (!Number.isFinite(height) || height <= 0) return 0;
  const ratio = (clientY - top) / height;
  return clamp(Math.round(ratio * totalSlots), 0, totalSlots);
}

export function keyboardTargetAdminSlot({ edge, start, end, key }) {
  const delta = key === 'ArrowUp' ? -1 : (key === 'ArrowDown' ? 1 : 0);
  if (!delta) return null;
  return (edge === 'start' ? start : end) + delta;
}

export function keyboardAdminResizeCommand({ edge, key, range, originalRange, totalSlots }) {
  if (key === 'Enter' || key === ' ') return { action: 'commit', range };
  if (key === 'Escape') return { action: 'cancel', range: originalRange };
  const targetSlot = keyboardTargetAdminSlot({ edge, ...range, key });
  if (targetSlot == null) return null;
  return {
    action: 'preview',
    range: resizeAdminRange({ ...range, edge, targetSlot, totalSlots }),
  };
}

export function resizeAdminRange({ start, end, edge, targetSlot, totalSlots, minSlots = 2, maxSlots = 16 }) {
  const snappedSlot = Math.round(targetSlot);
  if (edge === 'start') {
    return { start: clamp(snappedSlot, Math.max(0, end - maxSlots), end - minSlots), end };
  }
  if (edge === 'end') {
    return { start, end: clamp(snappedSlot, start + minSlots, Math.min(totalSlots, start + maxSlots)) };
  }
  throw new Error('不支援的行政時段拖曳邊框。');
}
