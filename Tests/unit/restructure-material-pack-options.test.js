const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

function loadNewUiLayoutHelpers() {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiLayout.tsx"), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, {
    module,
    exports: module.exports,
    require: () => ({}),
    Map,
    Set,
  });
  return module.exports;
}

function readNewUiLayoutSource() {
  const root = path.resolve(__dirname, "../..");
  return fs.readFileSync(path.join(root, "Apps/Workbench/src/components/new-ui/NewUiLayoutRoot.tsx"), "utf8");
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `expected to find ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `expected to find ${end}`);
  return source.slice(startIndex, endIndex);
}

const {
  mergeMaterialPackOptions,
  replacePendingMaterialPackSelection,
  resolveConversationDefaultMaterialPackSelection,
  setRestructureMaterialPackSelectionForScope,
  upsertMaterialPackOption,
} = loadNewUiLayoutHelpers();

test("material pack option merge keeps completed result over pending placeholder", () => {
  const pending = {
    sampleVideoId: "pending:batch_1:batch_item_1",
    artifactId: null,
    title: "缺失6 - 副本 - 副本",
    pending: true,
  };
  const ready = {
    sampleVideoId: "sample_missing_6_copy_copy",
    artifactId: "artifact_user_material_pack",
    title: "缺失6_-_副本_-_副本",
    resultUri: "/runtime/user-material-pack.stable.json",
  };

  const upserted = upsertMaterialPackOption([ready], pending);
  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].artifactId, "artifact_user_material_pack");
  assert.equal(upserted[0].pending, undefined);

  const merged = mergeMaterialPackOptions([pending], [ready]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].artifactId, "artifact_user_material_pack");
  assert.equal(merged[0].pending, undefined);
  assert.equal(replacePendingMaterialPackSelection(pending, [ready]), ready);
});

test("material pack option merge keeps failed result over pending placeholder", () => {
  const pending = {
    sampleVideoId: "sample_failed",
    artifactId: null,
    title: "acc1-restructure-e2e-copy",
    uploadKey: "upload:batch_808d:batch_item_63f",
    pending: true,
  };
  const failed = {
    sampleVideoId: "sample_failed",
    artifactId: null,
    title: "acc1-restructure-e2e-copy",
    uploadKey: "upload:batch_808d:batch_item_63f",
    failed: true,
    errorMessage: "切镜 Agent 未返回明确切镜边界",
  };

  const upserted = upsertMaterialPackOption([pending], failed);

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].pending, undefined);
  assert.equal(upserted[0].failed, true);
  assert.equal(upserted[0].errorMessage, "切镜 Agent 未返回明确切镜边界");
});

test("conversation default material pack replaces pending upload selection", () => {
  const pending = {
    sampleVideoId: "pending:batch_7c2a:batch_item_3d3d",
    artifactId: null,
    title: "aba23",
    uploadKey: "upload:batch_7c2a:batch_item_3d3d",
    pending: true,
  };
  const conversation = {
    conversationId: "conversation_a030",
    defaultMaterialPackRef: {
      sampleVideoId: "sample_e3f7",
      artifactId: "artifact_f396",
      title: "aba23.mp4",
      resultUri: "/runtime/Artifacts/sample_e3f7/analysis-results/user_material_pack/artifact_f396.json",
      shotCardCount: 4,
      materialGroupCount: 2,
      proofCoverageCount: 8,
    },
  };

  const selected = resolveConversationDefaultMaterialPackSelection(pending, conversation, "conversation_a030", false);

  assert.equal(selected.pending, undefined);
  assert.equal(selected.sampleVideoId, "sample_e3f7");
  assert.equal(selected.artifactId, "artifact_f396");
  assert.equal(selected.resultUri, "/runtime/Artifacts/sample_e3f7/analysis-results/user_material_pack/artifact_f396.json");
  assert.equal(selected.shotCardCount, 4);
});

test("draft material selection updates stay isolated from conversation selection", () => {
  let conversationSelection = {
    sampleVideoId: "sample_existing",
    artifactId: "artifact_existing",
    title: "已有会话素材",
    resultUri: "/runtime/existing.json",
  };
  let draftSelection = null;
  const draftReady = {
    sampleVideoId: "sample_draft",
    artifactId: "artifact_draft",
    title: "草稿素材",
    resultUri: "/runtime/draft.json",
  };

  setRestructureMaterialPackSelectionForScope(
    "draft",
    draftReady,
    (value) => {
      conversationSelection = typeof value === "function" ? value(conversationSelection) : value;
    },
    (value) => {
      draftSelection = typeof value === "function" ? value(draftSelection) : value;
    },
  );

  assert.equal(conversationSelection.sampleVideoId, "sample_existing");
  assert.equal(draftSelection.sampleVideoId, "sample_draft");
  assert.equal(draftSelection.resultUri, "/runtime/draft.json");
});

test("draft material upload does not create or select a conversation", () => {
  const source = readNewUiLayoutSource();
  const handlerSource = sliceBetween(source, "const handleRestructureMaterialUploadChange", "const handleSidebarRestructureConversationChange");

  assert.equal(handlerSource.includes("startAgentChatThread"), false);
  assert.equal(handlerSource.includes("selectRestructureConversation"), false);
  assert.equal(handlerSource.includes("upsertConversation"), false);
  assert.match(handlerSource, /uploadStartedInDraft \? null : selectedRestructureConversation\?\.conversationId \?\? null/);
  assert.match(handlerSource, /selectionScope: RestructureMaterialSelectionScope = uploadStartedInDraft \? "draft" : "conversation"/);
  assert.match(handlerSource, /\btargetConversationId,/);
  assert.match(handlerSource, /bindMaterialToConversation:\s*Boolean\(targetConversationId\)/);
});
