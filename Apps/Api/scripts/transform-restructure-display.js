#!/usr/bin/env node

const path = require("path");
const { randomUUID } = require("crypto");
const { createLocalStore } = require("../../../Infrastructure/Storage/local-store");
const { createStageLogger } = require("../../../Infrastructure/Observability/stage-logger");
const { createTraceIds } = require("../../../Infrastructure/Observability/trace");
const {
  STAGE_NAME,
  buildAgentRepairRequest,
  transformRestructureFinalFile,
} = require("../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }

  const rootDir = path.resolve(args.root ?? process.cwd());
  const inputPath = path.resolve(rootDir, args.input);
  const outputPath = path.resolve(rootDir, args.output ?? defaultOutputPath(args.input));
  const repairRequestPath = path.resolve(rootDir, args.repairRequest ?? defaultRepairRequestPath(args.input));
  const store = createLocalStore(rootDir);
  await store.ensureRuntimeDirs();
  const logger = createStageLogger(store);
  const traceContext = createTraceIds();
  const artifactId = args.artifactId ?? `artifact_${randomUUID()}`;
  const parentArtifactId = args.parentArtifactId ?? null;
  const inputSummary = {
    restructureFinalPath: safeRelative(rootDir, inputPath),
    outputPath: safeRelative(rootDir, outputPath),
    repairRequestPath: safeRelative(rootDir, repairRequestPath),
    restructureArtifactId: args.restructureArtifactId ?? null,
  };
  const startedAt = Date.now();

  await logger.writeStageLog({
    traceContext,
    event: "stage.start",
    stageName: STAGE_NAME,
    artifactId,
    parentArtifactId,
    inputSummary,
  });

  try {
    const result = await transformRestructureFinalFile({
      inputPath,
      outputPath,
      restructureArtifactId: args.restructureArtifactId ?? null,
    });
    await logger.writeStageLog({
      traceContext,
      event: "stage.end",
      stageName: STAGE_NAME,
      artifactId,
      parentArtifactId,
      durationMs: Date.now() - startedAt,
      outputSummary: {
        displayJsonPath: safeRelative(rootDir, outputPath),
        sectionCount: result.sourceTextDigest.sectionCount,
        missingSections: result.missingSections,
      },
    });
    process.stdout.write(`${JSON.stringify({
      ok: true,
      traceId: traceContext.traceId,
      artifactId,
      outputPath: safeRelative(rootDir, outputPath),
      missingSections: result.missingSections,
    }, null, 2)}\n`);
  } catch (error) {
    const repairRequest = buildAgentRepairRequest({
      error,
      inputPath: safeRelative(rootDir, inputPath),
      outputPath: safeRelative(rootDir, outputPath),
      restructureArtifactId: args.restructureArtifactId ?? null,
    });
    await store.writeJson(repairRequestPath, repairRequest);
    const snapshot = await logger.writeDebugSnapshot({
      traceContext,
      stageName: STAGE_NAME,
      artifactId,
      parentArtifactId,
      reason: error.code ?? "restructure_display_transform_failed",
      inputSummary,
      outputSummary: null,
      debugPayload: {
        errorCode: error.code ?? null,
        message: error.message,
        validationErrors: error.validationErrors ?? null,
        repairRequestPath: safeRelative(rootDir, repairRequestPath),
      },
    });
    await logger.writeStageLog({
      traceContext,
      event: "stage.fail",
      stageName: STAGE_NAME,
      artifactId,
      parentArtifactId,
      durationMs: Date.now() - startedAt,
      errorSummary: {
        code: error.code ?? "restructure_display_transform_failed",
        message: error.message,
        retryable: true,
        debugSnapshotUri: snapshot.uri,
      },
    });
    process.stderr.write(`${JSON.stringify({
      ok: false,
      traceId: traceContext.traceId,
      artifactId,
      error: error.code ?? "restructure_display_transform_failed",
      message: error.message,
      repairRequestPath: safeRelative(rootDir, repairRequestPath),
      debugSnapshotUri: snapshot.uri,
    }, null, 2)}\n`);
    process.exit(1);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--input") {
      args.input = argv[++index];
    } else if (arg === "--output") {
      args.output = argv[++index];
    } else if (arg === "--repair-request") {
      args.repairRequest = argv[++index];
    } else if (arg === "--root") {
      args.root = argv[++index];
    } else if (arg === "--restructure-artifact-id") {
      args.restructureArtifactId = argv[++index];
    } else if (arg === "--artifact-id") {
      args.artifactId = argv[++index];
    } else if (arg === "--parent-artifact-id") {
      args.parentArtifactId = argv[++index];
    }
  }
  return args;
}

function defaultOutputPath(input) {
  return path.join(path.dirname(input), "restructure.display.json");
}

function defaultRepairRequestPath(input) {
  return path.join(path.dirname(input), "restructure.display.repair-request.json");
}

function safeRelative(rootDir, filePath) {
  return path.relative(rootDir, path.resolve(rootDir, filePath)).replaceAll(path.sep, "/");
}

function printUsage() {
  process.stdout.write([
    "Usage: node Apps/Api/scripts/transform-restructure-display.js --input <restructure.final.md> [--output <json>]",
    "",
    "Converts fixed restructure.final.md sections into function_slot_restructure_display.v1 JSON.",
    "On validation failure, writes an agent repair request for format-only repair.",
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
