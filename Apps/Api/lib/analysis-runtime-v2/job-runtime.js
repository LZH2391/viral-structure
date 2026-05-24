function createJobRuntime({ jobStore, sampleStatus }) {
  function complete(context, patch = {}) {
    return jobStore.updateJob(context.job.jobId, {
      agentRun: context.agentRun
        ? { ...context.agentRun, status: "completed", updatedAt: new Date().toISOString() }
        : context.agentRun,
      stage: sampleStatus.processed,
      status: sampleStatus.processed,
      progress: 100,
      cachePrompt: null,
      errorSummary: null,
      activeThreadMessage: null,
      ...patch,
    });
  }

  function resumeProcessing(jobId, stage, progress) {
    return jobStore.updateJob(jobId, {
      cachePrompt: null,
      errorSummary: null,
      status: sampleStatus.processing,
      stage,
      progress,
    });
  }

  function markCacheWaiting(context, { stageName, progress, cachePrompt }) {
    return jobStore.updateJob(context.job.jobId, {
      status: sampleStatus.cacheWaiting,
      stage: stageName,
      progress,
      cachePrompt,
      errorSummary: null,
    });
  }

  return {
    complete,
    resumeProcessing,
    markCacheWaiting,
  };
}

module.exports = {
  createJobRuntime,
};
