function createExecutorRegistry(options = {}) {
  const executors = new Map();
  register(executors, createLocalServiceExecutor());
  register(executors, createThreadPoolRoleExecutor());
  executors.set("role-service", executors.get("threadpool-role"));
  executors.set("custom-service", executors.get("local-service"));
  register(executors, createAppServerTurnExecutor(options));
  register(executors, createUnsupportedExecutor("external-api"));
  register(executors, createUnsupportedExecutor("remote-job"));

  return {
    list: () => Array.from(executors.keys()),
    getExecutor: (executorKind) => executors.get(executorKind) ?? null,
    execute: async (executorKind, payload, context = {}) => {
      const executor = executors.get(executorKind);
      if (!executor) throw executorError("executor_not_found", "未知执行器", { executorKind }, false);
      return executor.execute(payload, context);
    },
  };
}

function register(executors, executor) {
  executors.set(executor.executorKind, executor);
}

function createLocalServiceExecutor() {
  return {
    executorKind: "local-service",
    execute: async ({ service, method = "enqueue", args = [] } = {}) => {
      if (!service || typeof service[method] !== "function") {
        throw executorError("local_service_method_missing", "本地服务方法不存在", { method }, false);
      }
      const result = await service[method](...args);
      return { status: "completed", result };
    },
  };
}

function createThreadPoolRoleExecutor() {
  return {
    executorKind: "threadpool-role",
    execute: async ({ service, method = "enqueue", args = [] } = {}) => {
      if (!service || typeof service[method] !== "function") {
        throw executorError("threadpool_role_service_missing", "ThreadPool role 服务方法不存在", { method }, false);
      }
      const result = await service[method](...args);
      return { status: "submitted", result };
    },
  };
}

function createAppServerTurnExecutor({ appServer } = {}) {
  return {
    executorKind: "appserver-turn",
    execute: async (payload = {}, context = {}) => {
      if (!appServer) throw executorError("appserver_turn_bridge_missing", "AppServer bridge 未配置", null, true);
      if (payload.action === "start-thread") return startThread(appServer, payload, context);
      if (payload.action === "submit-turn") return submitTurn(appServer, payload, context);
      if (payload.action === "collect-turn") return collectTurn(appServer, payload, context);
      throw executorError("appserver_turn_action_unknown", "未知 AppServer turn 操作", { action: payload.action }, false);
    },
  };
}

async function startThread(appServer, payload, context) {
  const runStage = requireRunStage(context);
  const result = await runStage(payload.stageName, payload.progress, {
    artifactId: payload.artifactId,
    parentArtifactId: payload.parentArtifactId,
    inputSummary: payload.inputSummary,
    action: () => appServer.startThread({
      workspaceRoot: payload.workspaceRoot,
      timeoutSeconds: payload.timeoutSeconds ?? 240,
    }),
    outputSummary: (output) => ({
      role: payload.role ?? null,
      threadId: output.threadId,
      status: output.status,
    }),
  });
  return {
    status: result.status ?? "submitted",
    threadId: result.threadId,
    result,
  };
}

async function submitTurn(appServer, payload, context) {
  const runStage = requireRunStage(context);
  const result = await runStage(payload.stageName, payload.progress, {
    artifactId: payload.artifactId,
    parentArtifactId: payload.parentArtifactId,
    inputSummary: payload.inputSummary,
    action: () => appServer.startTurnWithInputs({
      workspaceRoot: payload.workspaceRoot,
      threadId: payload.threadId,
      inputs: payload.inputs,
      skillPath: payload.skillPath,
      timeoutSeconds: payload.timeoutSeconds ?? 240,
    }),
    outputSummary: (output) => ({
      role: payload.role ?? null,
      threadId: output.threadId,
      turnId: output.turnId,
      status: output.status,
      inputMode: payload.inputMode ?? null,
    }),
  });
  return normalizeTurnResult(result);
}

async function collectTurn(appServer, payload, context) {
  const runStage = requireRunStage(context);
  const result = await runStage(payload.stageName, payload.progress, {
    artifactId: payload.artifactId,
    parentArtifactId: payload.parentArtifactId,
    inputSummary: payload.inputSummary,
    action: () => appServer.collectTurnResult({
      workspaceRoot: payload.workspaceRoot,
      threadId: payload.threadId,
      turnId: payload.turnId,
      timeoutSeconds: payload.timeoutSeconds ?? 60,
    }),
    outputSummary: (output) => ({
      role: payload.role ?? null,
      threadId: output.threadId,
      turnId: output.turnId,
      status: output.status,
      profileVersion: payload.profileVersion ?? null,
      promptTemplateId: payload.promptTemplateId ?? null,
      promptTemplateVersion: payload.promptTemplateVersion ?? null,
      promptTemplateHash: payload.promptTemplateHash ?? null,
    }),
  });
  return normalizeTurnResult(result);
}

function normalizeTurnResult(result) {
  return {
    status: result.status ?? null,
    threadId: result.threadId ?? null,
    turnId: result.turnId ?? null,
    finalMessage: result.finalMessage ?? null,
    activeThreadMessage: result.activeThreadMessage ?? null,
    turnActivity: result.turnActivity ?? null,
    finalMessageSummary: summarizeMessage(result.finalMessage),
    activeThreadMessageSummary: summarizeMessage(result.activeThreadMessage),
    errorSummary: summarizeError(result.errorSummary ?? result.error ?? null),
    result,
  };
}

function requireRunStage(context) {
  if (typeof context?.runStage !== "function") {
    throw executorError("executor_stage_logger_missing", "执行器缺少 stage logger", null, false);
  }
  return context.runStage;
}

function summarizeMessage(message) {
  const text = String(message ?? "").trim();
  if (!text) return null;
  const redacted = text
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/g, "[local-path]")
    .replace(/\/[^\s"'<>]+/g, "[local-path]");
  return {
    length: text.length,
    preview: redacted.length <= 240 ? redacted : `${redacted.slice(0, 240)}...`,
  };
}

function summarizeError(error) {
  if (!error) return null;
  if (typeof error === "string") return { message: summarizeMessage(error)?.preview ?? "执行失败" };
  return {
    code: error.code ?? null,
    message: summarizeMessage(error.message ?? error.summary ?? "执行失败")?.preview ?? "执行失败",
    retryable: typeof error.retryable === "boolean" ? error.retryable : null,
  };
}

function createUnsupportedExecutor(executorKind) {
  return {
    executorKind,
    execute: async () => {
      throw executorError("executor_not_implemented", "执行器尚未接入", { executorKind }, false);
    },
  };
}

function executorError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

module.exports = {
  createExecutorRegistry,
  executorError,
};
