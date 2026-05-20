const { randomUUID } = require("crypto");
const { SAMPLE_STATUS, createProcessingJob } = require("../../../Core/Workspace/sample-video-contracts");

function createJobStore() {
  const jobs = new Map();

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
    return job;
  }

  function updateJob(jobId, patch) {
    const current = jobs.get(jobId);
    const next = { ...current, ...patch };
    jobs.set(jobId, next);
    return next;
  }

  function getJob(jobId) {
    return jobs.get(jobId) ?? null;
  }

  return { createJob, updateJob, getJob };
}

module.exports = { createJobStore };
