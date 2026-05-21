const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const { SAMPLE_STATUS, createProcessingJob } = require("../../../Core/Workspace/sample-video-contracts");

function createJobStore({ filePath = null } = {}) {
  const jobs = new Map(loadJobs(filePath).map((job) => [job.jobId, job]));

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
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed.jobs) ? parsed.jobs.filter((job) => job?.jobId) : [];
  } catch {
    return [];
  }
}

function persistJobs(filePath, jobs) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ jobs: Array.from(jobs.values()) }, null, 2), "utf8");
}

module.exports = { createJobStore };
