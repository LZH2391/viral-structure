import type { SampleArtifact, ScriptSegmentArtifact, StructureCard } from "./types";

export function createStructureCardsFromSegments(artifact: SampleArtifact | null): StructureCard[] {
  const segments = artifact?.scriptSegmentAnalysis?.segments ?? [];
  if (!segments.length) return [];
  const parentArtifactId = artifact?.scriptSegmentAnalysis?.artifactId ?? artifact?.sampleVideo?.artifactId ?? null;
  return segments.map((segment, index) => mapSegmentToStructureCard(segment, parentArtifactId, index));
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
    shotRefs: segment.shotRefs,
    evidence: segment.evidence,
    confidence: segment.confidence,
    needReview: segment.needReview,
    sourceSegmentId: segment.segmentId,
  };
}
