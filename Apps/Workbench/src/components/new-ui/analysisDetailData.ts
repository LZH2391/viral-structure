import { getSampleArtifact } from "../../api/client";
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
  const artifact = item.sampleVideoId ? await getSampleArtifact(item.sampleVideoId) : null;
  const nextItem = withLoadedAnalysisHistoryArtifact(item, artifact);
  return {
    item: nextItem,
    media: resolveAnalysisHistoryMedia(nextItem),
  };
}
