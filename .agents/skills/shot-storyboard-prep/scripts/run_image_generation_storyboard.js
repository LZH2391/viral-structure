#!/usr/bin/env node
const path = require("node:path");
const { createLocalStore } = require("../../../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../../../Infrastructure/Observability/stage-logger");
const { createJobStore } = require("../../../../Apps/Api/lib/stores/job-store");
const { createImageGenerationService } = require("../../../../Apps/Api/lib/image-generation/service");

const DEFAULT_TIMEOUT_SECONDS = 450;
const DEFAULT_CONCURRENCY = 10;
const DEFAULT_POLL_SECONDS = 1;
const DEFAULT_WAIT_SECONDS = 1800;

main().catch((error) => {
  process.stdout.write(JSON.stringify({
    ok: false,
    status: "fatal",
    code: error.code ?? null,
    message: error.message,
  }, null, 2));
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.storyboardPromptFile) throw usageError("--storyboard-prompt-file is required");
  if (!args.sampleVideoId) throw usageError("--sample-video-id is required");

  hydratePPAPIEnv();
  const root = path.resolve(args.root ?? process.cwd());
  const store = createLocalStore(root);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const jobStore = createJobStore({ filePath: path.join(root, "Runtime", "Jobs", "image-generation-jobs.json") });
  const service = createImageGenerationService({ store, logger, jobStore });

  const timeoutSeconds = numberArg(args.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS);
  const storyboardConcurrency = numberArg(args.concurrency, DEFAULT_CONCURRENCY);
  const started = await service.enqueue({
    sampleVideoId: args.sampleVideoId,
    storyboardPromptFile: path.resolve(args.storyboardPromptFile),
    parentArtifactId: args.parentArtifactId ?? null,
    storyboardConcurrency,
    storyboardRetryAttempts: numberArg(args.retryAttempts, 2),
    timeoutSeconds,
  });

  const waitSeconds = numberArg(args.waitSeconds, DEFAULT_WAIT_SECONDS);
  const pollMs = numberArg(args.pollSeconds, DEFAULT_POLL_SECONDS) * 1000;
  const deadline = Date.now() + waitSeconds * 1000;
  let job = null;
  while (Date.now() <= deadline) {
    job = jobStore.getJob(started.processingJobId);
    if (job && ["processed", "failed"].includes(job.status)) break;
    await sleep(pollMs);
  }
  job = jobStore.getJob(started.processingJobId) ?? job;
  const timedOut = !job || !["processed", "failed"].includes(job.status);
  const output = summarizeJob({ started, job, timedOut, waitSeconds });
  process.stdout.write(JSON.stringify(output, null, 2));
  if (timedOut || output.status === "failed") process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

function hydratePPAPIEnv() {
  if (process.env.PPAPI) return;
  for (const name of ["PPTOKEN_API_KEY", "PPTOKEN"]) {
    if (process.env[name]) {
      process.env.PPAPI = process.env[name];
      return;
    }
  }
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function summarizeJob({ started, job, timedOut, waitSeconds }) {
  const artifact = job?.imageGenerationArtifact ?? null;
  return {
    ok: Boolean(job && job.status === "processed" && !timedOut),
    status: timedOut ? "wait_timeout" : job?.status ?? null,
    waitSeconds,
    started,
    stage: job?.stage ?? null,
    progress: job?.progress ?? null,
    errorSummary: job?.errorSummary ?? null,
    outputSummary: job?.outputSummary ?? null,
    imageGenerationRun: job?.imageGenerationRun ?? null,
    artifact: artifact ? {
      artifactId: artifact.artifactId,
      uri: artifact.uri,
      images: artifact.images,
      storyboardGroups: artifact.storyboardGroups?.map((group) => ({
        groupId: group.groupId,
        shots: group.shots.map((shot) => shot.shot),
        images: group.images,
      })),
    } : null,
  };
}

function usageError(message) {
  const error = new Error(`${message}\nUsage: node run_image_generation_storyboard.js --storyboard-prompt-file <file> --sample-video-id <id> [--parent-artifact-id <id>] [--concurrency 10] [--retry-attempts 2] [--timeout-seconds 450]`);
  error.code = "usage_error";
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
