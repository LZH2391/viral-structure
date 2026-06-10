#!/usr/bin/env node

const fs = require("fs/promises");
const path = require("path");
const zlib = require("zlib");
const { createLocalStore } = require("../../../Infrastructure/Storage/local-store");
const { transformRestructureFinalFile } = require("../../../Infrastructure/FunctionSlotRestructureDisplay/markdown-transformer");
const {
  buildSlotAtomDisplaySummary,
  readRestructureFinalFingerprint,
} = require("../lib/agent-chat/restructure-auto-display-utils");

const CONVERSATION_ID = "conversation_restructure_debug";
const PLAN_SET_ID = "debug-multi-version-plan";
const TURN_ID = "turn_debug_slot_chain";
const CONFIRMATION_ID = "confirm_debug_plan";
const THREAD_ID = "11111111-1111-4111-8111-111111111111";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(args.root ?? process.cwd());
  const store = createLocalStore(rootDir);
  await store.ensureRuntimeDirs();

  const planRoot = path.join(rootDir, "Artifacts", "FunctionSlotRestructure", PLAN_SET_ID);
  const versions = [
    {
      versionId: "V1_click",
      versionName: "高点击版",
      slotId: "SUB_debug_click",
      slotName: "熟悉经验钩子槽",
      functionText: "先建立观看理由",
      shotIds: ["shot_v1_01", "shot_v1_02"],
    },
    {
      versionId: "V2_conversion",
      versionName: "高转化版",
      slotId: "SUB_debug_conversion",
      slotName: "低门槛价值锚点槽",
      functionText: "快速给出转化理由",
      shotIds: ["shot_v2_01", "shot_v2_02"],
    },
  ];

  await fs.rm(planRoot, { recursive: true, force: true });
  await fs.mkdir(planRoot, { recursive: true });
  await fs.writeFile(path.join(planRoot, "restructure.final.md"), buildVersionIndexMarkdown(versions), "utf8");

  const versionDisplays = [];
  for (const version of versions) {
    const versionDir = path.join(planRoot, "versions", version.versionId);
    await fs.mkdir(versionDir, { recursive: true });
    const restructureFinalPath = path.join(versionDir, "restructure.final.md");
    const displayJsonPath = path.join(versionDir, "restructure.display.json");
    await fs.writeFile(restructureFinalPath, buildRestructureMarkdown(version), "utf8");
    const displayJson = await transformRestructureFinalFile({
      inputPath: restructureFinalPath,
      outputPath: displayJsonPath,
      restructureArtifactId: `artifact_${version.versionId}`,
    });
    const relativeDisplayPath = safeRelative(rootDir, displayJsonPath);
    const fileFingerprint = await readRestructureFinalFingerprint(restructureFinalPath, rootDir);
    versionDisplays.push({
      ...buildSlotAtomDisplaySummary(displayJson, {
        displayJsonPath: relativeDisplayPath,
        fileFingerprint,
      }),
      mode: "multi_version",
      versionId: version.versionId,
      versionName: version.versionName,
      rootRestructureFinalPath: safeRelative(rootDir, path.join(planRoot, "restructure.final.md")),
      sourceRestructureFinalPath: safeRelative(rootDir, restructureFinalPath),
    });
    await writeStoryboardFixture({ rootDir, versionDir, version });
  }

  const defaultDisplay = versionDisplays.find((display) => display.versionId === "V2_conversion") ?? versionDisplays[0];
  const now = new Date().toISOString();
  const conversation = {
    conversationId: CONVERSATION_ID,
    schemaVersion: "agent_chat_conversation.v1",
    revision: 1,
    source: "threadpool-role",
    role: "function-slot-restructure",
    status: "active",
    title: "Debug 多版本重组方案",
    threadId: THREAD_ID,
    parentThreadId: null,
    leaseId: null,
    ownerId: null,
    workspaceRoot: rootDir,
    skillPath: "C:/ByteDanceFullStack/.agents/skills/function-slot-restructure/SKILL.md",
    sampleVideoId: "debug-restructure",
    latestTurnId: TURN_ID,
    traceId: "trace_debug_restructure",
    runId: "run_debug_restructure",
    stageId: "stage_debug_restructure",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    invalidated: false,
    threadStopped: false,
    confirmedPlan: {
      status: "completed",
      mode: "multi_version",
      defaultVersionId: "V2_conversion",
      turnId: TURN_ID,
      confirmationId: CONFIRMATION_ID,
      confirmedAt: now,
      updatedAt: now,
      note: "调试夹具：已确认当前多版本方案。",
      sourceRestructurePath: defaultDisplay.sourceRestructureFinalPath,
      sourceShotDesignPath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/V2_conversion/shot-design.final.md`,
      storyboardArtifact: {
        artifactId: "artifact_debug_storyboard_v2",
        status: "processed",
        traceId: "trace_debug_storyboard",
        runId: "run_debug_storyboard",
        stageId: "stage_debug_storyboard",
      },
      storyboardVersions: versions.map((version) => ({
        versionId: version.versionId,
        versionName: version.versionName,
        status: "completed",
        sourceRestructurePath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/${version.versionId}/restructure.final.md`,
        sourceShotDesignPath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/${version.versionId}/shot-design.final.md`,
        storyboardArtifact: {
          artifactId: `artifact_debug_storyboard_${version.versionId}`,
          status: "processed",
        },
      })),
      traceId: "trace_debug_confirm",
      runId: "run_debug_confirm",
      stageId: "stage_debug_confirm",
    },
    defaultMaterialPackRef: {
      sampleVideoId: "sample_debug_material",
      artifactId: "artifact_debug_material_pack",
      title: "Debug 素材包",
      traceId: "trace_debug_material",
      resultUri: "Runtime/Artifacts/sample_debug_material/user-material-pack.stable.json",
      shotCardCount: 3,
      materialGroupCount: 2,
      proofCoverageCount: 1,
    },
    messages: [
      {
        id: `user-${TURN_ID}`,
        turnId: TURN_ID,
        role: "user",
        text: "请基于当前素材生成两版槽位链。",
        status: "completed",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: `assistant-${TURN_ID}`,
        turnId: TURN_ID,
        role: "assistant",
        text: `已生成多版本方案：[restructure.final.md](/C:/ByteDanceFullStack/Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/restructure.final.md)\n\n保存路径：\`Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/restructure.final.md\``,
        status: "completed",
        slotAtomDisplay: {
          ...defaultDisplay,
          mode: "multi_version",
          defaultVersionId: "V2_conversion",
          versionDisplays,
        },
        dialogueRoboticReview: {
          schemaVersion: "dialogue_robotic_review.v1",
          status: "processed",
          decision: "pass",
          issueCount: 0,
          shotDesignFinalPath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/V2_conversion/shot-design.final.md`,
          reviewOutputPath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/V2_conversion/dialogue-review.final.json`,
          traceId: "trace_debug_dialogue_review",
          runId: "run_debug_dialogue_review",
          stageId: "stage_debug_dialogue_review",
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "material-gap-matrix-debug",
        turnId: TURN_ID,
        role: "system",
        text: "素材缺口矩阵：2 个槽位需关注",
        status: "completed",
        materialGapMatrix: buildMaterialGapMatrix(now),
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "storyboard-result-debug",
        turnId: TURN_ID,
        role: "system",
        text: "方案完成",
        status: "completed",
        storyboardResult: {
          schemaVersion: "agent_chat_storyboard_result.v1",
          mode: "multi_version",
          defaultVersionId: "V2_conversion",
          planRevisionKey: `${CONVERSATION_ID}:${TURN_ID}:debug`,
          turnId: TURN_ID,
          confirmationId: CONFIRMATION_ID,
          status: "completed",
          sourceRestructurePath: defaultDisplay.sourceRestructureFinalPath,
          sourceShotDesignPath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/V2_conversion/shot-design.final.md`,
          storyboardArtifact: {
            artifactId: "artifact_debug_storyboard_v2",
            status: "processed",
          },
          versions: versions.map((version) => ({
            versionId: version.versionId,
            versionName: version.versionName,
            status: "completed",
            sourceRestructurePath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/${version.versionId}/restructure.final.md`,
            sourceShotDesignPath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/${version.versionId}/shot-design.final.md`,
            storyboardArtifact: {
              artifactId: `artifact_debug_storyboard_${version.versionId}`,
              status: "processed",
            },
          })),
          createdAt: now,
          updatedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "user-auto-advance-debug-duplicate",
        turnId: "turn_debug_auto_advance_duplicate",
        role: "user",
        text: "继续完善 Shot 设计",
        status: "completed",
        userInputOrigin: "auto_advance",
        sourceRestructurePath: defaultDisplay.sourceRestructureFinalPath,
        sourceRestructureFingerprint: defaultDisplay.fileFingerprint,
        sourceDisplayFingerprint: defaultDisplay.fileFingerprint,
        createdAt: now,
        updatedAt: now,
      },
    ],
  };

  const conversationDir = path.join(store.runtimeRoot, "AgentConversations");
  await fs.mkdir(conversationDir, { recursive: true });
  await fs.writeFile(path.join(conversationDir, `${CONVERSATION_ID}.json`), `${JSON.stringify(conversation, null, 2)}\n`, "utf8");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    conversationId: CONVERSATION_ID,
    planRoot: safeRelative(rootDir, planRoot),
    versions: versionDisplays.map((display) => ({
      versionId: display.versionId,
      displayJsonPath: display.displayJsonPath,
      sourceRestructureFinalPath: display.sourceRestructureFinalPath,
    })),
  }, null, 2)}\n`);
}

function buildVersionIndexMarkdown(versions) {
  return [
    "# 多版本索引",
    "",
    "保存路径：`Artifacts/FunctionSlotRestructure/debug-multi-version-plan/restructure.final.md`",
    "",
    "| versionId | versionName | path |",
    "|---|---|---|",
    ...versions.map((version) => `| \`${version.versionId}\` | ${version.versionName} | [restructure.final.md](versions/${version.versionId}/restructure.final.md) |`),
    "",
    "defaultVersionId: `V2_conversion`",
  ].join("\n");
}

function buildRestructureMarkdown(version) {
  return [
    "# 重组方案",
    "",
    `保存路径：\`Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/${version.versionId}/restructure.final.md\``,
    `versionId：\`${version.versionId}\``,
    `versionName：${version.versionName}`,
    "",
    "## 1. 重组目标与假设",
    "",
    "### 输入分层",
    "",
    `- brief：${version.versionName} 调试方案。`,
    "",
    "## 2. 最终功能槽位链",
    "",
    "### 素材供给判断",
    "",
    "| 供给类型 | 可支持的视频路径 |",
    "|---|---|",
    "| `material_partial_support` | 可支持核心镜头，但需要 ShotDesign 补足证明镜头 |",
    "",
    "### 槽位链",
    "",
    "| 顺序 | 需求 | slotSubtype | parent archetype | 链路功能 | 本方案用法 | 选择理由 |",
    "|---:|---|---|---|---|---|---|",
    `| 1 | 首秒建立兴趣 | \`${version.slotId}\` ${version.slotName} | \`ARCH_debug\` 调试原型 | ${version.functionText} | 对齐素材与包装 | 用于浏览器调试多版本选择 |`,
    "",
    "## 3. Atoms 落地表",
    "",
    "| 槽位 | 来源 | script atom（原标签 → 本方案落地） | rhythm atom（原标签 → 本方案落地） | packaging atom（原标签 → 本方案落地） | atom 处理 |",
    "|---|---|---|---|---|---|",
    `| \`${version.slotId}\` | \`DebugSample::F001\` | \`DebugSample::script::${version.versionId}\`：${version.versionName}脚本 | \`DebugSample::rhythm::${version.versionId}\`：${version.versionName}节奏 | \`DebugSample::packaging::${version.versionId}\`：${version.versionName}包装 | 同源复用 |`,
    "",
    "## 4. Adapter 方案",
    "",
    "调试夹具，不做跨样例 adapter。",
    "",
    "## 5. 脚本段落方案",
    "",
    "| 脚本段落 | 使用 script atom | 段落任务 | 本方案表达 | 承接/依赖 | 证明义务 |",
    "|---|---|---|---|---|---|",
    `| 段落 1 | \`DebugSample::script::${version.versionId}\` | 建立兴趣 | ${version.versionName}表达 | 无 | 证明素材是否足够 |`,
    "",
    "## 6. 节奏曲线",
    "",
    "| 节奏区间 | 使用 rhythm atom | 注意力状态 | 速度/密度 | 峰值/停顿/回落 | 必须同步点 |",
    "|---|---|---|---|---|---|",
    `| 区间 1 | \`DebugSample::rhythm::${version.versionId}\` | 注意力进入 | 快 | 首秒峰值 | 镜头切入 |`,
    "",
    "## 7. 包装与证明方案",
    "",
    "| 包装块 | 使用 packaging atom | 服务主张 | 证明功能 | 覆盖层与视觉证明落地 | 字幕层规格 | 风险 |",
    "|---|---|---|---|---|---|---|",
    `| 包装块 1 | \`DebugSample::packaging::${version.versionId}\` | ${version.versionName}主张 | 强化证明 | 标题条 + 局部放大 | 重点词加粗 | 素材不足时需生成补镜 |`,
  ].join("\n");
}

async function writeStoryboardFixture({ rootDir, versionDir, version }) {
  const framesDir = path.join(versionDir, "shot-storyboard-frames");
  await fs.mkdir(framesDir, { recursive: true });
  await fs.writeFile(path.join(versionDir, "shot-design.final.md"), buildShotDesignMarkdown(version), "utf8");
  await fs.writeFile(path.join(versionDir, "shot-storyboard-manifest.json"), `${JSON.stringify({
    schemaVersion: "shot_storyboard_manifest.v1",
    aspect: "16:9",
    cover: {
      coverId: "cover_image",
      overlayPackaging: `${version.versionName}封面包装`,
    },
    shots: [
      {
        shotId: version.shotIds[0],
        slotKey: version.slotId,
        slotSubtype: version.slotName,
        duration: "0.8-1.0s",
        dialogue: `${version.versionName}，先看这一眼就够了。`,
        strategy: "使用现有素材开场，保留人物/商品进入瞬间。",
        strategyRaw: "现有素材优先",
        shouldGenerate: false,
        sourceRefs: ["material:debug-opening"],
      },
      {
        shotId: version.shotIds[1],
        slotKey: version.slotId,
        slotSubtype: version.slotName,
        duration: "1.0-1.4s",
        dialogue: "这里补一个证明镜头，把卖点说实。",
        strategy: "生成或补拍局部证明镜头，避免只有口播没有画面证据。",
        strategyRaw: "补证明镜头",
        shouldGenerate: true,
        sourceRefs: ["generated:proof-closeup"],
      },
    ],
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(framesDir, "cover_image.png"), pngBuffer("#222222"));
  await fs.writeFile(path.join(framesDir, `${version.shotIds[0]}.png`), pngBuffer(version.versionId === "V1_click" ? "#2F80ED" : "#27AE60"));
  await fs.writeFile(path.join(framesDir, `${version.shotIds[1]}.png`), pngBuffer(version.versionId === "V1_click" ? "#F2994A" : "#EB5757"));
  await fs.writeFile(path.join(framesDir, "shot-storyboard-crops.json"), `${JSON.stringify({
    schemaVersion: "shot_storyboard_crops.v1",
    source: {
      traceId: `trace_debug_${version.versionId}`,
      artifactId: `artifact_debug_${version.versionId}`,
      parentArtifactId: TURN_ID,
    },
    crops: [
      { shotId: "cover_image", isCover: true, path: "cover_image.png", cropBox: { width: 1600, height: 900 } },
      { shotId: version.shotIds[0], path: `${version.shotIds[0]}.png`, cropBox: { width: 1600, height: 900 } },
      { shotId: version.shotIds[1], path: `${version.shotIds[1]}.png`, cropBox: { width: 1600, height: 900 } },
    ],
  }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(versionDir, "shot-storyboard-pdf-input.json"), `${JSON.stringify({
    schemaVersion: "shot_storyboard_pdf_input.v1",
    source: { rootDir: safeRelative(rootDir, versionDir) },
    cover: { imagePath: safeRelative(rootDir, path.join(framesDir, "cover_image.png")) },
    groups: [],
  }, null, 2)}\n`, "utf8");
}

function buildShotDesignMarkdown(version) {
  return [
    "# Shot 设计",
    "",
    `保存路径：\`Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/${version.versionId}/shot-design.final.md\``,
    "",
    "| shot | 画面 | 台词/字幕（若有） |",
    "|---|---|---|",
    `| ${version.shotIds[0]} | 开场素材 | ${version.versionName}，先看这一眼就够了。 |`,
    `| ${version.shotIds[1]} | 证明补镜 | 这里补一个证明镜头，把卖点说实。 |`,
  ].join("\n");
}

function buildMaterialGapMatrix(now) {
  return {
    schemaVersion: "material_gap_matrix.v1",
    status: "processed",
    artifactId: "artifact_debug_material_gap",
    parentArtifactId: TURN_ID,
    matrixJsonPath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/material-gap.matrix.json`,
    sourceRestructurePath: `Artifacts/FunctionSlotRestructure/${PLAN_SET_ID}/versions/V2_conversion/restructure.final.md`,
    sourceMaterialPackArtifactId: "artifact_debug_material_pack",
    sourceMaterialPackPath: "Runtime/Artifacts/sample_debug_material/user-material-pack.stable.json",
    summary: {
      slotCount: 3,
      satisfiedCount: 1,
      partialCount: 1,
      missingCount: 1,
      unsafeCount: 0,
      notRequiredCount: 0,
      topMissingMaterialTypes: ["product_closeup_shot", "comparison_shot"],
      overallImpact: "核心开场可用，但证明镜头需要 ShotDesign 兜底。",
    },
    rows: [
      {
        slotId: "F001",
        slotSubtype: "熟悉经验钩子槽",
        slotFunction: "首秒建立兴趣",
        requiredMaterialTypes: ["opening_hook_shot"],
        directSatisfaction: "satisfied",
        missingMaterialTypes: [],
        impact: "可直接使用已有开场素材。",
        availableEvidenceRefs: ["shot_card_001"],
        handoffToShotDesign: "保留现有开场。",
      },
      {
        slotId: "F002",
        slotSubtype: "低门槛价值锚点槽",
        slotFunction: "快速给出转化理由",
        requiredMaterialTypes: ["product_closeup_shot", "usage_process_shot"],
        directSatisfaction: "partial",
        missingMaterialTypes: ["product_closeup_shot"],
        impact: "缺少商品局部证明，容易变成纯口播。",
        availableEvidenceRefs: ["shot_card_002"],
        handoffToShotDesign: "用生成局部证明镜头补足。",
      },
      {
        slotId: "F003",
        slotSubtype: "对比证明槽",
        slotFunction: "让卖点有可见证据",
        requiredMaterialTypes: ["comparison_shot"],
        directSatisfaction: "missing",
        missingMaterialTypes: ["comparison_shot"],
        impact: "没有对比镜头时，证明力度不足。",
        availableEvidenceRefs: [],
        handoffToShotDesign: "设计包装对比或生成静态对照画面。",
      },
    ],
    traceId: "trace_debug_material_gap",
    runId: "run_debug_material_gap",
    stageId: "stage_debug_material_gap",
    stageName: "agentChat.materialGap.autoAudit",
    role: "function-slot-shot-design",
    turnId: TURN_ID,
    createdAt: now,
    updatedAt: now,
  };
}

function pngBuffer(hexColor) {
  const { r, g, b } = parseHexColor(hexColor);
  const width = 24;
  const height = 14;
  const rawRows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 4;
      const highlight = x < width / 2 && y < height / 2 ? 24 : 0;
      row[offset] = Math.min(255, r + highlight);
      row[offset + 1] = Math.min(255, g + highlight);
      row[offset + 2] = Math.min(255, b + highlight);
      row[offset + 3] = 255;
    }
    rawRows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.concat([
      uint32(width),
      uint32(height),
      Buffer.from([8, 6, 0, 0, 0]),
    ])),
    pngChunk("IDAT", zlib.deflateSync(Buffer.concat(rawRows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function parseHexColor(value) {
  const match = /^#?([a-f0-9]{6})$/i.exec(String(value ?? ""));
  const hex = match?.[1] ?? "555555";
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  return Buffer.concat([
    uint32(data.length),
    typeBuffer,
    data,
    uint32(crc32(Buffer.concat([typeBuffer, data]))),
  ]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0, 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") args.root = argv[++index];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  if (args.help) {
    process.stdout.write("Usage: node Apps/Api/scripts/seed-restructure-debug-fixture.js [--root <repo-root>]\n");
    process.exit(0);
  }
  return args;
}

function safeRelative(rootDir, filePath) {
  return path.relative(rootDir, path.resolve(filePath)).replaceAll(path.sep, "/");
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
