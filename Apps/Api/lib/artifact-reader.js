const fs = require("fs");
const path = require("path");

async function loadCurrentSampleArtifact({ sampleVideoId, store, artifactIndex }) {
  const indexed = await artifactIndex.getItem(sampleVideoId);
  const latest = indexed?.fileHash ? await artifactIndex.findLatestItemByFileHash(indexed.fileHash) : null;
  if (latest?.artifact) return latest.artifact;
  if (indexed?.artifact) return indexed.artifact;

  const artifactPath = path.join(store.sampleDir(sampleVideoId), "artifact.json");
  if (!fs.existsSync(artifactPath)) return null;
  return store.readJson(artifactPath);
}

module.exports = {
  loadCurrentSampleArtifact,
};
