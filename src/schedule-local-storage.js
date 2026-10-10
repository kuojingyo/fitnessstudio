// Bookings and closed days share one atomic item. Web Locks serialize tabs;
// optimistic snapshot validation rejects stale callers instead of restoring data.
export function createLocalScheduleStorage(getStorage, stateKey, keys, withLock) {
  const allowed = new Set(keys);
  let observed;
  function read() {
    const storage = getStorage();
    const raw = storage.getItem(stateKey);
    if (raw === null) return Object.fromEntries(keys.map(key => [key, storage.getItem(key)]));
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || Array.isArray(state)
      || keys.some(key => !Object.hasOwn(state, key) || (state[key] !== null && typeof state[key] !== 'string'))) {
      throw new Error('Invalid local schedule state');
    }
    return Object.fromEntries(keys.map(key => [key, state[key]]));
  }
  function getItems() {
    const state = read();
    observed = JSON.stringify(state);
    return state;
  }
  async function setItems(updates) {
    if (Object.entries(updates).some(([key, value]) => !allowed.has(key) || typeof value !== 'string')) {
      throw new Error('Invalid local schedule update');
    }
    const expected = observed ?? JSON.stringify(read());
    const lockedWrite = () => {
      const current = read();
      if (JSON.stringify(current) !== expected) {
        throw new Error('Local schedule changed in another tab; refresh before retrying');
      }
      const next = { ...current, ...updates };
      getStorage().setItem(stateKey, JSON.stringify(next));
      observed = JSON.stringify(next);
    };
    if (withLock) return withLock(lockedWrite);
    if (!globalThis.navigator?.locks?.request) {
      throw new Error('Safe local schedule storage requires Web Locks');
    }
    return globalThis.navigator.locks.request(stateKey, lockedWrite);
  }
  return {
    getItems,
    getItem(key) {
      if (!allowed.has(key)) throw new Error('Unknown local schedule key');
      return getItems()[key];
    },
    setItem: (key, value) => setItems({ [key]: value }),
    setItems,
  };
}
