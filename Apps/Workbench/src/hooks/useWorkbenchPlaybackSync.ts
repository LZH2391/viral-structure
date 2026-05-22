import { useEffect, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import type { ShotBoundaryAnalysisArtifact, StructureCard } from "../types";
import { findCurrentShot, findCurrentStructureCard } from "../utils/workbenchHelpers";

export function useWorkbenchPlaybackSync({
  videoRef,
  structureCards,
  shotBoundaryAnalysis,
  lastSegmentIdRef,
  lastShotIdRef,
}: {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  structureCards: StructureCard[];
  shotBoundaryAnalysis: ShotBoundaryAnalysisArtifact | null;
  lastSegmentIdRef: MutableRefObject<string | null>;
  lastShotIdRef: MutableRefObject<string | null>;
}) {
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const syncPlaybackContext = (forceUpdate = false) => {
      const time = video.currentTime || 0;
      const card = findCurrentStructureCard(structureCards, time);
      const shot = findCurrentShot(shotBoundaryAnalysis?.shots, time);
      const nextSegmentId = card?.id ?? null;
      const nextShotId = shot?.id ?? null;
      const segmentChanged = nextSegmentId !== lastSegmentIdRef.current;
      const shotChanged = nextShotId !== lastShotIdRef.current;
      lastSegmentIdRef.current = nextSegmentId;
      lastShotIdRef.current = nextShotId;
      if (forceUpdate || segmentChanged || shotChanged) {
        setCurrentTime(time);
      }
    };
    const onTimeUpdate = () => syncPlaybackContext(false);
    const onSeeked = () => syncPlaybackContext(true);
    const onLoadedMetadata = () => syncPlaybackContext(true);
    syncPlaybackContext(true);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [lastSegmentIdRef, lastShotIdRef, shotBoundaryAnalysis, structureCards, videoRef]);

  const currentCard = useMemo(() => findCurrentStructureCard(structureCards, currentTime), [currentTime, structureCards]);
  const currentShot = useMemo(() => findCurrentShot(shotBoundaryAnalysis?.shots, currentTime), [currentTime, shotBoundaryAnalysis]);

  return {
    currentTime,
    setCurrentTime,
    currentCard,
    currentShot,
  };
}
