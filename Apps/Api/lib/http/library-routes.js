const fs = require("fs/promises");
const { sendJson, notFound } = require("./utils");

async function handleLibraryItems(res, handlers = {}) {
  return sendJson(res, 200, { items: await handlers.artifactIndex.listItems() });
}

async function handleLibraryItem(res, sampleVideoId, handlers = {}) {
  const item = await handlers.artifactIndex.getItem(sampleVideoId);
  if (!item) return notFound(res);
  return sendJson(res, 200, item);
}

async function handleLibraryLoad(res, sampleVideoId, handlers = {}) {
  const artifact = await handlers.artifactIndex.loadItem(sampleVideoId);
  if (!artifact) return notFound(res);
  return sendJson(res, 200, { sampleArtifact: artifact });
}

async function handleLibraryDeleteCache(res, sampleVideoId, handlers = {}) {
  const result = await handlers.artifactIndex.deleteCacheForItem(sampleVideoId);
  if (!result) return notFound(res);
  for (const removedId of result.removedSampleVideoIds) {
    await fs.rm(handlers.store.sampleDir(removedId), { recursive: true, force: true }).catch(() => undefined);
  }
  return sendJson(res, 200, { ok: true, ...result });
}

module.exports = {
  handleLibraryItems,
  handleLibraryItem,
  handleLibraryLoad,
  handleLibraryDeleteCache,
};
