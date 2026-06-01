const locks = new WeakMap();

function lockStoreForSample(store, sampleVideoId, action) {
  if (!store || !sampleVideoId) return action();
  let sampleLocks = locks.get(store);
  if (!sampleLocks) {
    sampleLocks = new Map();
    locks.set(store, sampleLocks);
  }
  const key = String(sampleVideoId);
  const previous = sampleLocks.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  sampleLocks.set(key, next);
  return next.finally(() => {
    if (sampleLocks.get(key) === next) sampleLocks.delete(key);
  });
}

module.exports = {
  lockStoreForSample,
};
