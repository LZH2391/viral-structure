import { getSampleArtifact } from "../../api/client";
import { getPlatformRuntimeState } from "../../api/platformClient";
import {
  resolveAnalysisHistoryMedia,
  withLoadedAnalysisHistoryArtifact,
  type AnalysisHistoryItem,
  type AnalysisHistoryMedia,
} from "./analysisHistoryData";

export type AnalysisDetailLoadResult = {
  item: AnalysisHistoryItem;
  media: AnalysisHistoryMedia;
};

export async function loadAnalysisDetailItem(item: AnalysisHistoryItem): Promise<AnalysisDetailLoadResult> {
  const [artifact, runtimeState] = await Promise.all([
    item.sampleVideoId ? getSampleArtifact(item.sampleVideoId) : null,
    item.workflowRunId ? getPlatformRuntimeState("workflowRun", item.workflowRunId).catch(() => null) : null,
  ]);
  const nextItem = {
    ...withLoadedAnalysisHistoryArtifact(item, artifact),
    runtimeState,
  };
  return {
    item: nextItem,
    media: resolveAnalysisHistoryMedia(nextItem),
  };
}
