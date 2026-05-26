function summarizeAppServerBridgeDebug(details) {
  const structured = isRecord(details?.structured) ? details.structured : null;
  const stdoutStructured = isRecord(details?.stdoutStructured) ? details.stdoutStructured : null;
  const source = structured ?? stdoutStructured ?? details;
  if (!isRecord(source) && !details?.stdout && !details?.stderr) return null;
  return {
    operation: toText(source?.operation, 80),
    threadId: toText(source?.threadId, 80),
    turnId: toText(source?.turnId, 80),
    transportUrl: toText(source?.transportUrl, 160),
    bridgeError: toText(source?.error, 120),
    bridgeMessage: toText(source?.message, 240),
    stderrTail: toText(details?.stderr, 600),
    stdoutTail: toText(details?.stdout, 600),
  };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toText(value, maxLength) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

module.exports = {
  summarizeAppServerBridgeDebug,
};
