import { STAGES } from "../state";
import type { ModuleSummary, SampleArtifact } from "../types";

export type AnalysisKind = "scriptSegment" | "rhythmStructure" | "packagingStructure" | "functionSlotAtomization";

export type AnalysisRoleMetadata = {
  kind: AnalysisKind;
  moduleId: string;
  analysisId: string;
  cacheKind: string;
  artifactKey: "scriptSegmentAnalysis" | "rhythmStructureAnalysis" | "packagingStructureAnalysis" | "functionSlotAtomizationAnalysis";
  historyKey: "scriptSegmentAnalysisHistory" | "rhythmStructureAnalysisHistory" | "packagingStructureAnalysisHistory" | "functionSlotAtomizationAnalysisHistory";
  stageId: string;
  initialStage: string;
  cacheLookupStage: string;
  displayName: string;
  completeReason: string;
  refreshReason: string;
  reuseReason: string;
  invalidResultMessage: string;
  failureMessage: string;
  timeoutMessage: string;
  stageLabels: Record<string, string>;
  getArtifact: (artifact: SampleArtifact) => { artifactId?: string | null; parentArtifactId?: string | null } | null | undefined;
  getArtifactId: (artifact: SampleArtifact) => string;
  getParentArtifactId: (artifact: SampleArtifact) => string | null;
};

type AnalysisRoleSurfaceBinding = Omit<AnalysisRoleMetadata, "moduleId" | "analysisId" | "cacheKind" | "artifactKey" | "historyKey" | "stageId" | "initialStage" | "cacheLookupStage" | "displayName" | "completeReason" | "refreshReason" | "reuseReason" | "invalidResultMessage" | "failureMessage" | "timeoutMessage" | "stageLabels"> & {
  fallback: Pick<AnalysisRoleMetadata, "moduleId" | "analysisId" | "cacheKind" | "artifactKey" | "historyKey" | "stageId" | "initialStage" | "cacheLookupStage" | "displayName" | "completeReason" | "refreshReason" | "reuseReason" | "invalidResultMessage" | "failureMessage" | "timeoutMessage" | "stageLabels">;
};

export const ANALYSIS_ROLES: Record<AnalysisKind, AnalysisRoleMetadata> = {
  scriptSegment: createAnalysisRoleMetadata({
    kind: "scriptSegment",
    fallback: {
      moduleId: "script-segments",
      analysisId: "script-segments",
      cacheKind: "script_segment",
      artifactKey: "scriptSegmentAnalysis",
      historyKey: "scriptSegmentAnalysisHistory",
      stageId: STAGES.scriptSegmentAnalyze,
      initialStage: "script_segment.input_prepare",
      cacheLookupStage: "script_segment.cache_lookup",
      displayName: "脚本段落",
      completeReason: "结构理解完成",
      refreshReason: "脚本段落重新生成",
      reuseReason: "脚本段落复用缓存",
      invalidResultMessage: "脚本段落分析未返回有效产物",
      failureMessage: "脚本段落分析失败",
      timeoutMessage: "脚本段落分析超时",
      stageLabels: {
        "script_segment.cache_lookup": "检查脚本段落缓存",
        "script_segment.input_prepare": "准备脚本段落输入",
        "script_segment.input_package": "生成脚本段落输入包",
        "script_segment.analyze": "分析脚本段落",
        "script_segment.validate": "校验脚本段落结果",
        "script_segment.repair": "修复脚本段落结果",
        "script_segment.cache_reuse": "复用脚本段落缓存",
        "script_segment.materialize": "写入脚本段落产物",
      },
    },
    getArtifact: (artifact) => artifact.scriptSegmentAnalysis,
    getArtifactId: (artifact) => artifact.scriptSegmentAnalysis?.artifactId ?? artifact.sampleVideo.artifactId,
    getParentArtifactId: (artifact) => artifact.scriptSegmentAnalysis?.parentArtifactId ?? artifact.shotBoundaryAnalysis?.artifactId ?? null,
  }),
  rhythmStructure: createAnalysisRoleMetadata({
    kind: "rhythmStructure",
    fallback: {
      moduleId: "rhythm-structure",
      analysisId: "rhythm-structure",
      cacheKind: "rhythm_structure",
      artifactKey: "rhythmStructureAnalysis",
      historyKey: "rhythmStructureAnalysisHistory",
      stageId: STAGES.rhythmStructureAnalyze,
      initialStage: "rhythm_structure.input_prepare",
      cacheLookupStage: "rhythm_structure.cache_lookup",
      displayName: "节奏结构",
      completeReason: "节奏结构完成",
      refreshReason: "节奏结构重新生成",
      reuseReason: "节奏结构复用缓存",
      invalidResultMessage: "节奏结构分析未返回有效产物",
      failureMessage: "节奏结构分析失败",
      timeoutMessage: "节奏结构分析超时",
      stageLabels: {
        "rhythm_structure.cache_lookup": "检查节奏结构缓存",
        "rhythm_structure.input_prepare": "准备节奏结构输入",
        "rhythm_structure.input_package": "生成节奏结构输入包",
        "rhythm_structure.analyze": "分析节奏结构",
        "rhythm_structure.validate": "校验节奏结构结果",
        "rhythm_structure.repair": "修复节奏结构结果",
        "rhythm_structure.cache_reuse": "复用节奏结构缓存",
        "rhythm_structure.materialize": "写入节奏结构产物",
      },
    },
    getArtifact: (artifact) => artifact.rhythmStructureAnalysis,
    getArtifactId: (artifact) => artifact.rhythmStructureAnalysis?.artifactId ?? artifact.sampleVideo.artifactId,
    getParentArtifactId: (artifact) => artifact.rhythmStructureAnalysis?.parentArtifactId ?? artifact.shotBoundaryAnalysis?.artifactId ?? null,
  }),
  packagingStructure: createAnalysisRoleMetadata({
    kind: "packagingStructure",
    fallback: {
      moduleId: "packaging-structure",
      analysisId: "packaging-structure",
      cacheKind: "packaging_structure",
      artifactKey: "packagingStructureAnalysis",
      historyKey: "packagingStructureAnalysisHistory",
      stageId: STAGES.packagingStructureAnalyze,
      initialStage: "packaging_structure.input_prepare",
      cacheLookupStage: "packaging_structure.cache_lookup",
      displayName: "包装结构",
      completeReason: "包装结构完成",
      refreshReason: "包装结构重新生成",
      reuseReason: "包装结构复用缓存",
      invalidResultMessage: "包装结构分析未返回有效产物",
      failureMessage: "包装结构分析失败",
      timeoutMessage: "包装结构分析超时",
      stageLabels: {
        "packaging_structure.cache_lookup": "检查包装结构缓存",
        "packaging_structure.input_prepare": "准备包装结构输入",
        "packaging_structure.input_package": "生成包装结构输入包",
        "packaging_structure.analyze": "分析包装结构",
        "packaging_structure.validate": "校验包装结构结果",
        "packaging_structure.repair": "修复包装结构结果",
        "packaging_structure.cache_reuse": "复用包装结构缓存",
        "packaging_structure.materialize": "写入包装结构产物",
      },
    },
    getArtifact: (artifact) => artifact.packagingStructureAnalysis,
    getArtifactId: (artifact) => artifact.packagingStructureAnalysis?.artifactId ?? artifact.sampleVideo.artifactId,
    getParentArtifactId: (artifact) => artifact.packagingStructureAnalysis?.parentArtifactId ?? artifact.shotBoundaryAnalysis?.artifactId ?? null,
  }),
  functionSlotAtomization: createAnalysisRoleMetadata({
    kind: "functionSlotAtomization",
    fallback: {
      moduleId: "function-slot-atomization",
      analysisId: "function-slot-atomization",
      cacheKind: "function_slot_atomization",
      artifactKey: "functionSlotAtomizationAnalysis",
      historyKey: "functionSlotAtomizationAnalysisHistory",
      stageId: STAGES.functionSlotAtomizationAnalyze,
      initialStage: "function_slot_atomization.input_prepare",
      cacheLookupStage: "function_slot_atomization.cache_lookup",
      displayName: "功能槽位原子化",
      completeReason: "功能槽位原子化完成",
      refreshReason: "功能槽位原子化重新生成",
      reuseReason: "功能槽位原子化复用缓存",
      invalidResultMessage: "功能槽位原子化未返回有效产物",
      failureMessage: "功能槽位原子化失败",
      timeoutMessage: "功能槽位原子化超时",
      stageLabels: {
        "function_slot_atomization.input_prepare": "准备原子化输入",
        "function_slot_atomization.input_package": "生成原子化输入包",
        "function_slot_atomization.cache_lookup": "检查原子化缓存",
        "function_slot_atomization.analyze": "分析功能槽位原子",
        "function_slot_atomization.validate": "校验原子化结果",
        "function_slot_atomization.repair": "修复原子化结果",
        "function_slot_atomization.cache_reuse": "复用原子化缓存",
        "function_slot_atomization.materialize": "写入原子化产物",
      },
    },
    getArtifact: (artifact) => artifact.functionSlotAtomizationAnalysis,
    getArtifactId: (artifact) => artifact.functionSlotAtomizationAnalysis?.artifactId ?? artifact.sampleVideo.artifactId,
    getParentArtifactId: (artifact) => artifact.functionSlotAtomizationAnalysis?.parentArtifactId ?? artifact.packagingStructureAnalysis?.artifactId ?? artifact.sampleVideo.artifactId,
  }),
};

function createAnalysisRoleMetadata(binding: AnalysisRoleSurfaceBinding): AnalysisRoleMetadata {
  const fallback = binding.fallback;
  return {
    ...binding,
    ...fallback,
    analysisId: fallback.moduleId,
  };
}

export function mergeAnalysisRoleModules(modules: ModuleSummary[]) {
  const byStageKind = new Map(modules
    .filter((module) => module.moduleKind === "structure-analysis" && module.ui?.stageKind)
    .map((module) => [module.ui?.stageKind, module]));
  return Object.fromEntries(
    Object.entries(ANALYSIS_ROLES).map(([kind, role]) => {
      const module = byStageKind.get(kind);
      if (!module) return [kind, role];
      return [kind, applyModuleProjection(role, module)];
    }),
  ) as Record<AnalysisKind, AnalysisRoleMetadata>;
}

function applyModuleProjection(role: AnalysisRoleMetadata, module: ModuleSummary): AnalysisRoleMetadata {
  return {
    ...role,
    moduleId: module.moduleId,
    analysisId: module.moduleId,
    cacheKind: module.cacheKind ?? role.cacheKind,
    artifactKey: module.artifactKey as AnalysisRoleMetadata["artifactKey"] ?? role.artifactKey,
    stageId: module.ui?.stageId ?? role.stageId,
    displayName: module.ui?.displayName ?? role.displayName,
    completeReason: module.ui?.completeReason ?? role.completeReason,
    refreshReason: module.ui?.refreshReason ?? role.refreshReason,
    reuseReason: module.ui?.reuseReason ?? role.reuseReason,
    invalidResultMessage: module.ui?.invalidResultMessage ?? role.invalidResultMessage,
    failureMessage: module.ui?.failureMessage ?? role.failureMessage,
    timeoutMessage: module.ui?.timeoutMessage ?? role.timeoutMessage,
  };
}

export function getAnalysisRole(kind: AnalysisKind) {
  return ANALYSIS_ROLES[kind];
}

export function listAnalysisRoles() {
  return Object.values(ANALYSIS_ROLES);
}

export function getAnalysisRoleByCacheKind(cacheKind?: string | null) {
  if (!cacheKind) return null;
  return listAnalysisRoles().find((role) => role.cacheKind === cacheKind) ?? null;
}

export function setAnalysisRoleModules(modules: ModuleSummary[]) {
  const nextRoles = mergeAnalysisRoleModules(modules);
  for (const role of Object.values(nextRoles)) {
    ANALYSIS_ROLES[role.kind] = role;
  }
}
