const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { server: defaultServer, createServer } = require("../../Apps/Api/server");
const { createAgentConversationStore } = require("../../Apps/Api/lib/agent-chat/conversation-store");
const { maybeAutoAuditMaterialGaps } = require("../../Apps/Api/lib/agent-chat/material-gap-auto-audit");
const { maybeAutoReviewShotDialogue, reviewShotDialogueForConversation } = require("../../Apps/Api/lib/agent-chat/shot-dialogue-auto-review");

test.after(() => {
  if (defaultServer.listening) defaultServer.close();
});

function makeRequest(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        ...(body ? { "content-type": "application/json" } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

function makeRawRequest(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        ...(body ? { "content-type": "application/json" } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    request.on("error", reject);
    if (body) request.write(JSON.stringify(body));
    request.end();
  });
}

async function writeRollout(codexHome, threadId, lines) {
  const dir = path.join(codexHome, "sessions", "2026", "06", "03");
  await fsPromises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `rollout-2026-06-03T21-55-17-${threadId}.jsonl`);
  await fsPromises.writeFile(filePath, lines.join("\n"), "utf8");
  return filePath;
}

function rolloutEvent(timestamp, type, payload) {
  return JSON.stringify({ timestamp, type, payload });
}

function makeMultipartRequest(server, { path: requestPath, fields = {}, file }) {
  const boundary = `----test-${Date.now().toString(36)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`, "utf8"));
  chunks.push(Buffer.from(file.content, "utf8"));
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method: "POST",
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": body.length,
      },
    }, (response) => {
      const responseChunks = [];
      response.on("data", (chunk) => responseChunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(responseChunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function makeMultipartFilesRequest(server, { path: requestPath, fields = {}, files = [] }) {
  const boundary = `----test-${Date.now().toString(36)}`;
  const chunks = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, "utf8"));
  }
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`, "utf8"));
    chunks.push(Buffer.from(file.content, "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, "utf8"));
  const body = Buffer.concat(chunks);
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method: "POST",
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: {
        connection: "close",
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "content-length": body.length,
      },
    }, (response) => {
      const responseChunks = [];
      response.on("data", (chunk) => responseChunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(responseChunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          headers: response.headers,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end(body);
  });
}

function buildMaterialGapMatrixFixture({ directSatisfaction = "missing", missingMaterialTypes = [] } = {}) {
  return {
    schemaVersion: "material_gap_matrix.v1",
    status: "processed",
    summary: {
      slotCount: 1,
      satisfiedCount: directSatisfaction === "satisfied" ? 1 : 0,
      partialCount: directSatisfaction === "partial" ? 1 : 0,
      missingCount: directSatisfaction === "missing" ? 1 : 0,
      unsafeCount: directSatisfaction === "unsafe" ? 1 : 0,
      notRequiredCount: directSatisfaction === "not_required" ? 1 : 0,
      topMissingMaterialTypes: missingMaterialTypes,
      overallImpact: "",
    },
    rows: [{
      slotId: "slot_1",
      slotSubtype: "SUB_demo",
      slotFunction: "演示使用过程",
      requiredMaterialTypes: ["usage_process_shot"],
      directSatisfaction,
      missingMaterialTypes,
      impact: "无法直接证明使用过程",
      availableEvidenceRefs: [],
      handoffToShotDesign: "需要补使用过程镜头",
    }],
  };
}

function buildMaterialGapAuditHandlers({ rootDir, createdMessages, turns }) {
  let turnIndex = 0;
  return {
    rootDir,
    logger: {
      writeStageLog: async () => undefined,
      writeDebugSnapshot: async () => ({ uri: "debug://snapshot" }),
    },
    agentConversationStore: {
      get: async () => ({
        conversationId: "conversation_1",
        role: "function-slot-restructure",
        threadId: "parent_thread",
        workspaceRoot: rootDir,
        messages: [{
          id: "user-turn_1",
          role: "user",
          turnId: "turn_1",
          text: "brief",
          materialPackRef: {
            artifactId: "pack_1",
            resultUri: path.join(rootDir, "material-pack.json"),
          },
        }],
      }),
      createMaterialGapMatrixMessage: async (payload) => {
        createdMessages.push(payload);
        return { conversationId: payload.conversationId, revision: createdMessages.length };
      },
    },
    appServer: {
      startThread: async () => ({ ok: true, threadId: "child_thread" }),
      runTurnWithInputs: async () => {
        const turn = turns[turnIndex] ?? turns[turns.length - 1];
        turnIndex += 1;
        return turn;
      },
    },
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function waitFor(predicate, { timeoutMs = 1000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitFor timeout");
}

async function exists(filePath) {
  try {
    await fsPromises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sampleRestructureFinalMarkdown() {
  return [
    "# 重组方案",
    "",
    "保存路径：`Artifacts/FunctionSlotRestructure/auto-demo/restructure.final.md`",
    "",
    "## 1. 重组目标与假设",
    "",
    "### 输入分层",
    "",
    "- brief：自动转换测试。",
    "",
    "## 2. 最终功能槽位链",
    "",
    "### 素材供给判断",
    "",
    "| 供给类型 | 可支持的视频路径 |",
    "|---|---|",
    "| `material_insufficient_for_full_video` | 不能独立支持完整视频 |",
    "",
    "### 槽位链",
    "",
    "| 顺序 | 需求 | slotSubtype | parent archetype | 链路功能 | 本方案用法 | 选择理由 |",
    "|---:|---|---|---|---|---|---|",
    "| 1 | 首秒说明对象 | `SUB_auto_demo` 自动展示 | `ARCH_auto_demo` 自动原型 | 建立观看理由 | 展示对象 | 测试脚本转换 |",
    "",
    "## 3. Atoms 落地表",
    "",
    "| 槽位 | 来源 | script atom（原标签 → 本方案落地） | rhythm atom（原标签 → 本方案落地） | packaging atom（原标签 → 本方案落地） | atom 处理 |",
    "|---|---|---|---|---|---|",
    "| `SUB_auto_demo` | `A::F001` | `A::script::S001`：自动脚本 | `A::rhythm::R001`：自动节奏 | `A::packaging::P001`：自动包装 | 同源复用 |",
    "",
    "## 4. Adapter 方案",
    "",
    "不转换。",
    "",
    "## 5. 脚本段落方案",
    "",
    "| 脚本段落 | 使用 script atom | 段落任务 | 本方案表达 | 承接/依赖 | 证明义务 |",
    "|---|---|---|---|---|---|",
    "| 段落 1 | `A::script::S001` | 自动任务 | 自动表达 | 无 | 不改内容 |",
    "",
    "## 6. 节奏曲线",
    "",
    "| 节奏区间 | 使用 rhythm atom | 注意力状态 | 速度/密度 | 峰值/停顿/回落 | 必须同步点 |",
    "|---|---|---|---|---|---|",
    "| 区间 1 | `A::rhythm::R001` | 自动注意 | 快 | 峰值 | 同步 |",
    "",
    "## 7. 包装与证明方案",
    "",
    "| 包装块 | 使用 packaging atom | 服务主张 | 证明功能 | 覆盖层与视觉证明落地 | 字幕层规格 | 风险 |",
    "|---|---|---|---|---|---|---|",
    "| 包装块 1 | `A::packaging::P001` | 自动主张 | 自动证明 | 自动覆盖 | 自动字幕 | 无 |",
  ].join("\n");
}

function sampleShotDesignFinalMarkdown() {
  return [
    "# Shot 设计",
    "",
    "保存路径：`Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md`",
    "",
    "| shot | 画面 | 台词/字幕（若有） |",
    "|---|---|---|",
    "| shot_001 | 包装近景 | 商品记忆轻转化，包装信息也给你看。 |",
    "| shot_002 | 成品杯 | 你看这个颜色，冲出来就是这种豆浆感。 |",
  ].join("\n");
}

function sampleShotDesignDialogueFingerprint(entries, filePath = "Artifacts/FunctionSlotRestructure/shot-demo/shot-design.final.md") {
  const normalized = entries.map(([shot, dialogue]) => `${shot}\t${dialogue}`).join("\n");
  return {
    path: filePath,
    size: entries.length,
    sha256: createHash("sha256").update(normalized).digest("hex"),
    entryCount: entries.length,
    nonEmptyCount: entries.filter(([, dialogue]) => dialogue && dialogue !== "无").length,
  };
}


module.exports = {
  test,
  assert,
  once,
  fsPromises,
  os,
  path,
  createHash,
  createServer,
  createAgentConversationStore,
  maybeAutoAuditMaterialGaps,
  maybeAutoReviewShotDialogue,
  reviewShotDialogueForConversation,
  makeRequest,
  makeRawRequest,
  writeRollout,
  rolloutEvent,
  makeMultipartRequest,
  makeMultipartFilesRequest,
  buildMaterialGapMatrixFixture,
  buildMaterialGapAuditHandlers,
  closeServer,
  waitFor,
  exists,
  sampleRestructureFinalMarkdown,
  sampleShotDesignFinalMarkdown,
  sampleShotDesignDialogueFingerprint,
};
