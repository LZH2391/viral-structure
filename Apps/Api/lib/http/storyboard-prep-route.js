const fs = require("fs");
const path = require("path");
const { sendJson } = require("./utils");
const { readJsonBody } = require("../observability/ui-debug-events");

const DEFAULT_ROOT_DIR = path.resolve(__dirname, "../../../..");

async function handleStoryboardPrepAutoRun(req, res, handlers = {}) {
  const body = await (handlers.readJsonBodyImpl ?? readJsonBody)(req).catch(() => ({}));
  const sampleVideoId = body.sampleVideoId ?? "function-slot-workflow";
  const parentArtifactId = body.parentArtifactId ?? body.restructureArtifactId ?? null;
  const resolvedInputs = await resolveStoryboardPrepInputs(body, handlers);
  if (!resolvedInputs.restructureFinalPath) {
    return sendJson(res, 400, {
      error: "storyboard_prep_restructure_required",
      code: "storyboard_prep_restructure_required",
      message: "需要可解析到文件的 restructureFinalPath；仅有 artifactId 时不会让 agent 猜路径",
      missing: ["restructureFinalPath"],
    });
  }
  if (!handlers.shotStoryboardAutoPipelineService?.enqueue) {
    return sendJson(res, 503, {
      error: "storyboard_prep_pipeline_unavailable",
      code: "storyboard_prep_pipeline_unavailable",
      message: "Shot Storyboard Prep pipeline 服务不可用",
    });
  }
  const result = await handlers.shotStoryboardAutoPipelineService.enqueue({
    ...body,
    ...resolvedInputs,
    sampleVideoId,
    parentArtifactId,
  });
  return sendJson(res, 202, result);
}

async function resolveStoryboardPrepInputs(body, handlers = {}) {
  const conversationId = normalizeOptionalText(body.conversationId);
  const conversation = conversationId ? await handlers.agentConversationStore?.get?.(conversationId) : null;
  const confirmed = conversation?.confirmedPlan ?? {};
  const explicitUserMaterialPackPath = normalizeOptionalText(body.userMaterialPackPath);
  return {
    restructureFinalPath: normalizeOptionalText(body.restructureFinalPath) ?? normalizeOptionalText(confirmed.sourceRestructurePath),
    shotDesignFinalPath: normalizeOptionalText(body.shotDesignFinalPath) ?? normalizeOptionalText(confirmed.sourceShotDesignPath),
    materialFrameMaps: normalizeStringArray(body.materialFrameMaps),
    materialFrameMap: normalizeOptionalText(body.materialFrameMap),
    visualManifest: normalizeOptionalText(body.visualManifest),
    frameMap: normalizeOptionalText(body.frameMap),
    userMaterialPackPath: explicitUserMaterialPackPath ?? inferUserMaterialPackPathFromConversation(conversation, handlers.rootDir ?? DEFAULT_ROOT_DIR),
    conversationId,
  };
}

function inferUserMaterialPackPathFromConversation(conversation, workspaceRoot = DEFAULT_ROOT_DIR) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (const message of messages) {
    const text = normalizeOptionalText(message?.text);
    if (!text) continue;
    for (const candidate of extractJsonPathCandidates(text)) {
      if (isUserMaterialPackPath(candidate, workspaceRoot)) return candidate;
    }
  }
  return null;
}

function extractJsonPathCandidates(text) {
  const matches = [];
  const pattern = /(?:[A-Za-z]:[\\/][^\s,，'"`<>]+?\.json|(?:\.{0,2}[\\/])?[A-Za-z0-9_.\-\\/]+?\.json)/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    const value = normalizeOptionalText(match[0]);
    if (value) matches.push(value);
  }
  return matches;
}

function isUserMaterialPackPath(candidate, workspaceRoot = DEFAULT_ROOT_DIR) {
  const text = normalizeOptionalText(candidate);
  if (!text) return false;
  const normalized = text.replaceAll("\\", "/").toLowerCase();
  if (!normalized.includes("user_material_pack") && !normalized.includes("user-material-pack")) return false;
  const resolved = path.isAbsolute(text) || /^[A-Za-z]:[\\/]/.test(text)
    ? path.resolve(text)
    : path.resolve(workspaceRoot, text);
  const root = path.resolve(workspaceRoot);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return false;
  if (!fs.existsSync(resolved)) return false;
  try {
    const preview = fs.readFileSync(resolved, "utf8").slice(0, 2000);
    return preview.includes('"type"') && preview.includes("user-material-pack");
  } catch {
    return false;
  }
}


function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeOptionalText).filter(Boolean);
}

module.exports = { handleStoryboardPrepAutoRun };
