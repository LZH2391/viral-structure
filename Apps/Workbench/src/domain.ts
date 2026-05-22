import type { ContentProfile, GeneratedPlan, Mapping, SampleArtifact, SampleVideo, ScriptSegmentArtifact, StructureCard } from "./types";
import { createId, sanitizeText } from "./utils/format";

export const PROMPT_TEMPLATE_VERSION = "workbench.transfer.v1";

export function createStructureCards(sample: SampleVideo | null): StructureCard[] {
  if (!sample) return [];
  const duration = Math.max(sample.duration, 12);
  const segments: Array<[string, number, number, string]> = [
    ["开头 hook", 0, Math.min(duration * 0.18, 4), "用冲突或强结果建立停留理由"],
    ["卖点推进", duration * 0.18, duration * 0.48, "用连续证据解释价值"],
    ["场景证明", duration * 0.48, duration * 0.76, "把卖点放进真实使用场景"],
    ["结尾转化", duration * 0.76, duration, "给出行动理由和记忆点"],
  ];
  return segments.map(([name, start, end, explanation], index) => ({
    id: createId("structure"),
    artifactId: createId("artifact"),
    parentArtifactId: sample.artifactId,
    name,
    start,
    end,
    order: index + 1,
    explanation,
    transferableRule: `${name} 保留节奏功能，替换为新主题证据`,
  }));
}

export function createStructureCardsFromSegments(artifact: SampleArtifact | null): StructureCard[] {
  const segments = artifact?.scriptSegmentAnalysis?.segments ?? [];
  if (!segments.length) return [];
  const parentArtifactId = artifact?.scriptSegmentAnalysis?.artifactId ?? artifact?.sampleVideo?.artifactId ?? null;
  return segments.map((segment, index) => mapSegmentToStructureCard(segment, parentArtifactId, index));
}

export function createGeneratedPlan(profile: ContentProfile, structureCards: StructureCard[], parentArtifactId: string) {
  const generatedArtifactId = createId("artifact");
  const generatedPlan: GeneratedPlan = {
    id: createId("generated"),
    artifactId: generatedArtifactId,
    parentArtifactId,
    title: `${profile.topic} 结构迁移方案`,
    coverTitle: `${profile.topic}：先给结果，再给理由`,
    shots: structureCards.map((card) => ({
      id: createId("shot"),
      sourceStructureId: card.id,
      start: card.start,
      end: card.end,
      beat: card.name,
      script: makeScriptLine(card, profile),
      subtitle: makeSubtitleLine(card, profile),
      camera: makeCameraLine(card),
    })),
  };
  const mappings: Mapping[] = generatedPlan.shots.map((shot) => {
    const source = structureCards.find((item) => item.id === shot.sourceStructureId);
    return {
      id: createId("mapping"),
      sourceName: source?.name ?? "样例结构",
      targetName: shot.beat,
      sourceArtifactId: source?.artifactId ?? parentArtifactId,
      targetArtifactId: generatedArtifactId,
      explanation: `${source?.name ?? "结构"} 的节奏功能迁移为 ${profile.topic} 的内容表达`,
    };
  });
  return { generatedPlan, mappings, generatedArtifactId };
}

export function buildContentProfile(form: HTMLFormElement | null): ContentProfile {
  const data = new FormData(form ?? undefined);
  return {
    topic: sanitizeText(data.get("topic"), 60) || "新主题",
    sellingPoints: sanitizeText(data.get("sellingPoints"), 120) || "核心卖点待补充",
    audience: sanitizeText(data.get("audience"), 60) || "目标人群待补充",
    platform: sanitizeText(data.get("platform"), 60) || "短视频平台",
    duration: sanitizeText(data.get("duration"), 32) || "与样例接近",
    tone: sanitizeText(data.get("tone"), 60) || "清晰、有节奏",
  };
}

function mapSegmentToStructureCard(segment: ScriptSegmentArtifact["segments"][number], parentArtifactId: string | null, index: number): StructureCard {
  return {
    id: segment.segmentId,
    artifactId: `${segment.segmentId}_structure`,
    parentArtifactId,
    name: segment.label,
    start: segment.start,
    end: segment.end,
    order: index + 1,
    explanation: segment.roleInScript,
    transferableRule: segment.transferableRule,
  };
}

function makeScriptLine(card: StructureCard, profile: ContentProfile) {
  const lines: Record<string, string> = {
    "开头 hook": `先抛出 ${profile.topic} 的高价值结果，让 ${profile.audience} 在第一秒知道为什么要看。`,
    "卖点推进": `围绕 ${profile.sellingPoints} 做连续解释，每个信息点都对应一个可见画面。`,
    "场景证明": `把 ${profile.topic} 放到 ${profile.platform} 的真实使用场景里，降低理解成本。`,
    "结尾转化": `用 ${profile.tone} 的语气收束，给出下一步行动和封面记忆点。`,
  };
  return lines[card.name] ?? `${card.name} 迁移到 ${profile.topic}`;
}

function makeSubtitleLine(card: StructureCard, profile: ContentProfile) {
  if (card.name === "开头 hook") return `别先讲原理，先看 ${profile.topic} 的结果`;
  if (card.name === "结尾转化") return `${profile.topic} 的关键，是把价值讲得更快`;
  return `${profile.sellingPoints}`;
}

function makeCameraLine(card: StructureCard) {
  const lines: Record<string, string> = {
    "开头 hook": "快切结果画面，字幕前置。",
    "卖点推进": "中近景交替，保留节奏停顿。",
    "场景证明": "场景全景切到细节特写。",
    "结尾转化": "回到核心画面，封面标题同步出现。",
  };
  return lines[card.name] ?? "跟随结构节奏切换画面。";
}
