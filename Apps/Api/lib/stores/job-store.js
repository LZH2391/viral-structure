const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { SAMPLE_STATUS, createProcessingJob } = require("../../../../Core/Workspace/sample-video-contracts");

function createJobStore({ filePath = null } = {}) {
  const { jobs: loadedJobs, changed } = loadJobs(filePath);
  const jobs = new Map(loadedJobs.map((job) => [job.jobId, job]));
  if (changed) persistJobs(filePath, jobs);

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
    persistJobs(filePath, jobs);
    return job;
  }

  function updateJob(jobId, patch) {
    const current = jobs.get(jobId);
    if (!current) return null;
    const next = { ...current, ...patch };
    jobs.set(jobId, next);
    persistJobs(filePath, jobs);
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

function loadJobs(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { jobs: [], changed: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed.jobs)) return { jobs: [], changed: false };
    let changed = false;
    const jobs = parsed.jobs.filter((job) => job?.jobId).map((job) => {
      const next = normalizeLoadedJob(job);
      if (next !== job) changed = true;
      return next;
    });
    return { jobs, changed };
  } catch {
    return { jobs: [], changed: false };
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

function persistJobs(filePath, jobs) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ jobs: Array.from(jobs.values()) }, null, 2), "utf8");
}

module.exports = { createJobStore };
