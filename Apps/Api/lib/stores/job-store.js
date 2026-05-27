const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { SAMPLE_STATUS, createProcessingJob } = require("../../../../Core/Workspace/sample-video-contracts");

const ACTIVE_JOBS_FILE = "active-jobs.json";
const LEGACY_JOBS_FILE = "processing-jobs.json";
const DEFAULT_TERMINAL_RETENTION = 50;

function createJobStore({ filePath = null, terminalRetention = DEFAULT_TERMINAL_RETENTION } = {}) {
  const storage = resolveStorage(filePath, terminalRetention);
  const { jobs: loadedJobs, changed, migratedLegacy } = loadJobs(storage);
  const jobs = new Map(loadedJobs.map((job) => [job.jobId, job]));
  if (changed) persistJobs(storage, jobs);
  if (migratedLegacy) removeLegacyJobsFile(storage);

  function createJob({ sampleVideoId, traceId }) {
    const job = createProcessingJob({
      jobId: `job_${randomUUID()}`,
      sampleVideoId,
      stage: "uploaded",
      status: SAMPLE_STATUS.pending,
      progress: 0,
      traceId,
    });
    jobs.set(job.jobId, job);
    persistJobs(storage, jobs);
    return job;
  }

  function updateJob(jobId, patch) {
    const current = jobs.get(jobId);
    if (!current) return null;
    const next = { ...current, ...patch };
    jobs.set(jobId, next);
    persistJobs(storage, jobs);
    return next;
  }

  function getJob(jobId) {
    return jobs.get(jobId) ?? null;
  }

  function listJobs() {
    return Array.from(jobs.values());
  }

  function listActiveAgentRuns({ role } = {}) {
    return listJobs().filter((job) => {
      const agentRun = job.agentRun;
      if (!agentRun) return false;
      if (role && agentRun.role !== role) return false;
      return ["turn_submitted", "collecting"].includes(agentRun.status) && job.status !== SAMPLE_STATUS.processed && job.status !== SAMPLE_STATUS.failed;
    });
  }

  return { createJob, updateJob, getJob, listJobs, listActiveAgentRuns };
}

function resolveStorage(filePath, terminalRetention) {
  if (!filePath) return null;
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const activeFilePath = basename === LEGACY_JOBS_FILE ? path.join(dir, ACTIVE_JOBS_FILE) : filePath;
  const legacyFilePath = basename === LEGACY_JOBS_FILE ? filePath : path.join(dir, LEGACY_JOBS_FILE);
  return {
    activeFilePath,
    legacyFilePath,
    archiveDir: path.join(dir, "archive"),
    terminalRetention: Math.max(0, Number.isFinite(Number(terminalRetention)) ? Number(terminalRetention) : DEFAULT_TERMINAL_RETENTION),
  };
}

function loadJobs(storage) {
  if (!storage) return { jobs: [], changed: false, migratedLegacy: false };
  const hasActive = fs.existsSync(storage.activeFilePath);
  const sourcePath = hasActive ? storage.activeFilePath : storage.legacyFilePath;
  const migratedLegacy = !hasActive && fs.existsSync(storage.legacyFilePath);
  if (!fs.existsSync(sourcePath)) return { jobs: [], changed: false, migratedLegacy: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
    if (!Array.isArray(parsed.jobs)) return { jobs: [], changed: false, migratedLegacy };
    let changed = false;
    const jobs = parsed.jobs.filter((job) => job?.jobId).map((job) => {
      const next = normalizeLoadedJob(job);
      if (next !== job) changed = true;
      return next;
    });
    return {
      jobs,
      changed: changed || migratedLegacy || splitJobsForActiveStorage(jobs, storage.terminalRetention).archivedJobs.length > 0,
      migratedLegacy,
    };
  } catch {
    return { jobs: [], changed: false, migratedLegacy };
  }
}

function normalizeLoadedJob(job) {
  if (isTerminalJob(job) || job.status === SAMPLE_STATUS.cacheWaiting) return job;
  return {
    ...job,
    status: SAMPLE_STATUS.failed,
    stage: job.stage ?? "interrupted",
    progress: Number.isFinite(Number(job.progress)) ? Number(job.progress) : 0,
    errorSummary: {
      code: "processing_job_interrupted_by_restart",
      message: "服务重启后，之前未完成的后台任务已中断，请重新运行该分析。",
      stageName: job.stage ?? null,
      retryable: true,
      debugSnapshotUri: null,
    },
    interruptedAt: new Date().toISOString(),
    interruptedReason: "server_restart",
  };
}

function isTerminalJob(job) {
  return job?.status === SAMPLE_STATUS.processed || job?.status === SAMPLE_STATUS.failed;
}

function isInterruptedRecoveryJob(job) {
  return job?.status === SAMPLE_STATUS.failed && job?.interruptedReason === "server_restart";
}

function persistJobs(storage, jobs) {
  if (!storage) return;
  const { activeJobs, archivedJobs } = splitJobsForActiveStorage(Array.from(jobs.values()), storage.terminalRetention);
  appendArchivedJobs(storage.archiveDir, archivedJobs);
  for (const job of archivedJobs) jobs.delete(job.jobId);
  fs.mkdirSync(path.dirname(storage.activeFilePath), { recursive: true });
  fs.writeFileSync(storage.activeFilePath, JSON.stringify({ jobs: activeJobs }, null, 2), "utf8");
}

function splitJobsForActiveStorage(allJobs, terminalRetention) {
  const activeJobs = [];
  const terminalJobs = [];
  allJobs.forEach((job, index) => {
    if (isInterruptedRecoveryJob(job)) {
      activeJobs.push(job);
    } else if (isTerminalJob(job)) {
      terminalJobs.push({ job, index });
    } else {
      activeJobs.push(job);
    }
  });
  terminalJobs.sort((left, right) => {
    const timeDiff = jobSortTime(left.job) - jobSortTime(right.job);
    return timeDiff || left.index - right.index;
  });
  const archiveCount = Math.max(0, terminalJobs.length - terminalRetention);
  const archivedJobs = terminalJobs.slice(0, archiveCount).map((entry) => entry.job);
  const retainedTerminalJobs = terminalJobs.slice(archiveCount).sort((left, right) => left.index - right.index).map((entry) => entry.job);
  return { activeJobs: [...activeJobs, ...retainedTerminalJobs], archivedJobs };
}

function appendArchivedJobs(archiveDir, archivedJobs) {
  if (!archivedJobs.length) return;
  fs.mkdirSync(archiveDir, { recursive: true });
  const byMonth = new Map();
  for (const job of archivedJobs) {
    const month = archiveMonth(job);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(JSON.stringify({ ...job, archivedAt: new Date().toISOString() }));
  }
  for (const [month, lines] of byMonth.entries()) {
    fs.appendFileSync(path.join(archiveDir, `${month}.jsonl`), `${lines.join("\n")}\n`, "utf8");
  }
}

function jobSortTime(job) {
  const candidates = [
    job.updatedAt,
    job.completedAt,
    job.interruptedAt,
    job.agentRun?.updatedAt,
    job.agentRun?.startedAt,
    job.createdAt,
  ];
  for (const candidate of candidates) {
    const time = Date.parse(candidate);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function archiveMonth(job) {
  const time = jobSortTime(job);
  const date = Number.isFinite(time) && time > 0 ? new Date(time) : new Date();
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function removeLegacyJobsFile(storage) {
  if (!storage?.legacyFilePath || storage.legacyFilePath === storage.activeFilePath) return;
  try {
    fs.unlinkSync(storage.legacyFilePath);
  } catch {
    // Best effort cleanup after a successful migration.
  }
}

module.exports = { createJobStore };
