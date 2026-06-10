const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { createLocalStore } = require("../../Infrastructure/Storage/local-store");
const { createFunctionSlotProjectionStore } = require("../../Infrastructure/FunctionSlotProjection/function-slot-projection-store");
const { createFunctionSlotProjectionService } = require("../../Apps/Api/lib/function-slot-projection/service");
const { createFunctionSlotLibraryService } = require("../../Apps/Api/lib/function-slot-library/service");

async function createTempLibraryService() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bd-function-slot-library-"));
  const store = createLocalStore(tempRoot);
  await store.ensureRuntimeDirs();
  const projectionStore = createFunctionSlotProjectionStore({ store });
  const projectionService = createFunctionSlotProjectionService({ store, projectionStore });
  const libraryRoot = path.join(tempRoot, "Artifacts", "FunctionSlotLibrary");
  return {
    store,
    projectionService,
    libraryRoot,
    service: createFunctionSlotLibraryService({
      rootDir: tempRoot,
      store,
      projectionService,
      libraryRoot,
      now: makeClock(),
    }),
  };
}

function makeClock() {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-05-26T00:00:0${tick}.000Z`;
  };
}

async function writeRuntimeArtifact(store, artifact) {
  const sampleDir = await store.ensureSampleDirs(artifact.sampleVideoId);
  await store.writeJson(path.join(sampleDir, "artifact.json"), artifact);
}

function buildArtifact({ artifactId = "artifact_function_slot", traceId = "trace_library", createdAt = "2026-05-26T00:00:00.000Z", extraSlot = false, status = "processed", emptyAtomization = false } = {}) {
  const slotTypes = emptyAtomization ? [] : extraSlot ? ["problem_activation", "result_confirmation", "trust_close"] : ["problem_activation", "result_confirmation"];
  return {
    sampleVideoId: "sample_library",
    trace: { traceId: "trace_sample" },
    sampleVideo: {
      original: {
        summary: "source-library.mp4",
      },
    },
      functionSlotAtomizationAnalysis: {
      artifactId,
      parentArtifactId: "artifact_packaging",
      traceId,
      type: "function-slot-atomization-analysis",
      status,
      stageName: "function_slot_atomization.materialize",
      sampleVideoId: "sample_library",
      sourceScriptSegmentArtifactId: "artifact_script",
      sourceRhythmStructureArtifactId: "artifact_rhythm",
      sourcePackagingStructureArtifactId: "artifact_packaging",
      sourceShotBoundaryArtifactId: "artifact_shot",
      atomInventory: {
        scriptAtoms: slotTypes.map((slot, index) => buildAtom("S", slot, index)),
        rhythmAtoms: slotTypes.map((slot, index) => buildAtom("R", slot, index)),
        packagingAtoms: slotTypes.map((slot, index) => buildAtom("P", slot, index)),
      },
      slotMap: {
        slots: slotTypes.map((slot, index) => ({
          slotId: `F${index + 1}`,
          slotOrder: index + 1,
          slotName: `slot ${index + 1}`,
          slotType: slot,
          viewerStateBefore: `before ${index + 1}`,
          viewerStateAfter: `after ${index + 1}`,
          persuasionTask: `task ${index + 1}`,
          scriptAtomIds: [`S${index + 1}`],
          rhythmAtomIds: [`R${index + 1}`],
          packagingAtomIds: [`P${index + 1}`],
          sourceRefs: { shotRefs: [`shot_${index + 1}`] },
          confidence: 0.9,
          needReview: false,
        })),
      },
      bindingGraph: {
        bindings: [1, 2].map((value) => ({
          id: `B${value}`,
          type: "sync",
          slotIds: [`F${value}`],
          atomIds: [`S${value}`, `R${value}`, `P${value}`],
          rule: `binding rule ${value}`,
          riskIfBroken: `risk ${value}`,
          confidence: 0.9,
        })),
      },
      conflictChecks: [{ id: "C1", slotIds: ["F1"], reason: "conflict", fix: "fix" }],
      recombinationRules: [{ id: "RULE1", reason: "rule", appliesTo: ["problem_activation"], sourceBindingIds: ["B1"] }],
      recompositionTemplates: [{ templateId: "T1", templateName: "template", sequence: slotTypes }],
      createdAt,
    },
    shotBoundaryAnalysis: {
      shots: slotTypes.map((slot, index) => ({
        id: `shot_${index + 1}`,
        shotNo: `S${String(index + 1).padStart(3, "0")}`,
        start: index * 1.2,
        end: (index + 1) * 1.2,
      })),
    },
    subtitles: {
      segments: slotTypes.map((slot, index) => ({
        id: `subtitle_${index + 1}`,
        start: index * 1.2,
        end: (index + 1) * 1.2,
        text: index === 0 ? "这是字幕" : `字幕${index + 1}`,
      })),
    },
  };
}

function buildGovernance() {
  return {
    schemaVersion: "function_slot_semantic_governance.v1",
    governanceId: "governance_test",
    coverage: {
      sampleCount: 4,
      slotVariantCount: 21,
      atomVariantCount: 64,
      bindingCount: 33,
      ruleCount: 39,
      validationOk: true,
    },
    slotFamilies: [{ id: "FAM_attention", name: "attention", sourceVariantIds: ["sample_a::F001"], support: { variantCount: 1, sampleCount: 1 } }],
    slotArchetypes: [{ id: "ARCH_hook", familyId: "FAM_attention", name: "hook", sourceVariantIds: ["sample_a::F001"], support: { variantCount: 1, sampleCount: 1 } }],
    slotSubtypes: [{ id: "SUB_visible_hook", archetypeId: "ARCH_hook", name: "visible hook", sourceVariantIds: ["sample_a::F001"], support: { variantCount: 1, sampleCount: 1 } }],
    atomArchetypes: [{ id: "ATOM_ARCH_script", name: "script", atomLayer: "script" }],
    atomPatterns: [{ id: "SCRIPT_pattern_hook", name: "script hook", atomLayer: "script", parentAtomArchetype: "ATOM_ARCH_script", forSlotSubtypeIds: ["SUB_visible_hook"], sourceVariantIds: ["sample_a::script::S001"], support: { variantCount: 1, sampleCount: 1 } }],
    bindingPrinciples: [{ id: "PRINCIPLE_close", name: "close", sourcePatternIds: ["BIND_pattern_close"] }],
    bindingPatterns: [{ id: "BIND_pattern_close", name: "binding close" }],
    recompositionPolicies: [{ id: "POLICY_close", name: "policy close", sourceRulePatternIds: ["RULE_pattern_close"] }],
    rulePatterns: [{ id: "RULE_pattern_close", name: "rule close" }],
    implementationBundles: [{ id: "BUNDLE_hook", name: "bundle hook", slotSubtypeIds: ["SUB_visible_hook"], scriptPatternIds: ["SCRIPT_pattern_hook"], rhythmPatternIds: [], packagingPatternIds: [], sourceVariantIds: ["sample_a::F001"] }],
    sourceVariants: [
      { variantId: "sample_a::F001", sampleId: "sample_a", kind: "slot", sourceId: "F001", label: "attention source" },
      { variantId: "sample_a::script::S001", sampleId: "sample_a", kind: "script", sourceId: "S001", label: "script hook source" },
    ],
    unmappedAtomVariants: [{ variantId: "sample_a::script::S002", reason: "single_sample", suggestedAction: "keep" }],
    unmappedBindingVariants: [],
    unmappedRuleVariants: [],
  };
}

function hasGovernanceStatusFields(data) {
  return Boolean(data && (
    Object.prototype.hasOwnProperty.call(data, "status")
    || Object.prototype.hasOwnProperty.call(data, "reviewStatus")
    || Object.prototype.hasOwnProperty.call(data, "maturityStatus")
    || Object.prototype.hasOwnProperty.call(data, "needReview")
  ));
}

function buildAtom(prefix, slot, index) {
  const id = `${prefix}${index + 1}`;
  return {
    id,
    slot,
    label: `${prefix} atom ${index + 1}`,
    function: `${prefix} function ${index + 1}`,
    claimType: prefix === "P" ? "visual_proof" : "claim",
    proofType: prefix === "P" ? "visual_proof" : "",
    packagingFunction: prefix === "P" ? `${prefix} function ${index + 1}` : "",
    proofNeed: prefix === "S" ? "proof" : "",
    pace: prefix === "R" ? "fast" : "",
    densityType: prefix === "R" ? "cut_density" : "",
    beatShape: prefix === "R" ? "beat" : "",
    visualHierarchy: prefix === "P" ? "hero_first" : "",
    visualElements: prefix === "P" ? ["subtitle"] : [],
    replaceableForms: prefix === "P" ? ["badge"] : [],
    risk: prefix === "P" ? "visual risk" : "",
    mustKeep: prefix === "S" ? ["claim"] : [],
    replaceableVariables: ["variable"],
    syncPoints: prefix === "R" ? ["cut"] : [],
    avoidFor: prefix === "R" ? ["slow"] : [],
    sourceRefs: { shotRefs: [`shot_${index + 1}`] },
    confidence: 0.9,
    needReview: false,
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function makeRequest(server, method, requestPath) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = require("node:http").request({
      agent: false,
      method,
      host: "127.0.0.1",
      port: address.port,
      path: requestPath,
      headers: { connection: "close" },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function makeJsonRequest(server, method, requestPath, body) {
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
        "content-type": "application/json",
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        response.destroy();
        resolve({
          statusCode: response.statusCode,
          body: text ? JSON.parse(text) : null,
        });
      });
    });
    request.on("error", reject);
    request.write(JSON.stringify(body));
    request.end();
  });
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

module.exports = {
  buildArtifact,
  buildGovernance,
  closeServer,
  createTempLibraryService,
  hasGovernanceStatusFields,
  makeJsonRequest,
  makeRequest,
  readJson,
  writeRuntimeArtifact,
};
