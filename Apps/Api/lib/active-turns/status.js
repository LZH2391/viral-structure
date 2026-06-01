const RUNNING_STATUSES = new Set(["created", "pending", "queued", "submitted", "running", "in_progress", "inprogress", "collecting"]);
const TERMINAL_STATUSES = new Set(["completed", "complete", "failed", "error", "errored", "cancelled", "canceled"]);

function normalizeTurnStatus(status) {
  const value = String(status ?? "").trim().toLowerCase();
  if (value === "cancelled") return "canceled";
  if (value === "inprogress") return "in_progress";
  return value || "unknown";
}

function isRunningTurnStatus(status) {
  return RUNNING_STATUSES.has(normalizeTurnStatus(status));
}

function isTerminalTurnStatus(status) {
  return TERMINAL_STATUSES.has(normalizeTurnStatus(status));
}

module.exports = {
  RUNNING_STATUSES,
  TERMINAL_STATUSES,
  isRunningTurnStatus,
  isTerminalTurnStatus,
  normalizeTurnStatus,
};
