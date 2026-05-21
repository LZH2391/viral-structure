import { RefObject, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { MediaKind } from "../types";

type TimelinePlaybackOptions = {
  activeMediaKind: MediaKind;
  videoRef: RefObject<HTMLVideoElement>;
  audioRef: RefObject<HTMLAudioElement>;
  onFrame: (time: number) => void;
};

export type TimelinePlaybackController = {
  mediaElement: HTMLMediaElement | null;
  seekTo: (time: number) => void;
  togglePlay: () => void;
  syncNow: () => void;
  getCurrentTime: () => number;
  isPlayingRef: MutableRefObject<boolean>;
};

export function useTimelinePlayback({ activeMediaKind, videoRef, audioRef, onFrame }: TimelinePlaybackOptions): TimelinePlaybackController {
  const [mediaElement, setMediaElement] = useState<HTMLMediaElement | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const rafIdRef = useRef(0);
  const isPlayingRef = useRef(false);
  const onFrameRef = useRef(onFrame);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    const nextMedia = resolveMediaElement(activeMediaKind, videoRef, audioRef);
    setMediaElement((current) => (current === nextMedia ? current : nextMedia));
  });

  const stopRaf = useCallback(() => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = 0;
  }, []);

  const tick = useCallback(() => {
    const media = mediaRef.current;
    if (!media) {
      stopRaf();
      return;
    }
    onFrameRef.current(media.currentTime || 0);
    rafIdRef.current = !media.paused && !media.ended ? requestAnimationFrame(tick) : 0;
  }, [stopRaf]);

  const syncNow = useCallback(() => {
    const media = mediaRef.current;
    onFrameRef.current(media?.currentTime || 0);
  }, []);

  useEffect(() => {
    const media = mediaElement;
    mediaRef.current = media;
    stopRaf();
    isPlayingRef.current = Boolean(media && !media.paused && !media.ended);
    syncNow();
    if (!media) return undefined;

    const onPlay = () => {
      isPlayingRef.current = true;
      stopRaf();
      rafIdRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      isPlayingRef.current = false;
      stopRaf();
      syncNow();
    };
    const onSeeked = () => syncNow();
    const onEnded = () => {
      isPlayingRef.current = false;
      stopRaf();
      syncNow();
    };

    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    media.addEventListener("seeked", onSeeked);
    media.addEventListener("loadedmetadata", onSeeked);
    media.addEventListener("ended", onEnded);
    if (!media.paused && !media.ended) onPlay();

    return () => {
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
      media.removeEventListener("seeked", onSeeked);
      media.removeEventListener("loadedmetadata", onSeeked);
      media.removeEventListener("ended", onEnded);
      stopRaf();
      if (mediaRef.current === media) mediaRef.current = null;
    };
  }, [mediaElement, stopRaf, syncNow, tick]);

  const seekTo = useCallback(
    (time: number) => {
      const media = mediaRef.current;
      if (media && Number.isFinite(time)) media.currentTime = Math.max(0, Math.min(resolveDuration(media), time));
      syncNow();
    },
    [syncNow],
  );

  const togglePlay = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused || media.ended) void media.play();
    else media.pause();
  }, []);

  const getCurrentTime = useCallback(() => mediaRef.current?.currentTime || 0, []);

  return useMemo(
    () => ({
      mediaElement,
      seekTo,
      togglePlay,
      syncNow,
      getCurrentTime,
      isPlayingRef,
    }),
    [getCurrentTime, mediaElement, seekTo, syncNow, togglePlay],
  );
}

function resolveMediaElement(activeMediaKind: MediaKind, videoRef: RefObject<HTMLVideoElement>, audioRef: RefObject<HTMLAudioElement>): HTMLMediaElement | null {
  if (activeMediaKind === "video") return videoRef.current;
  if (activeMediaKind === "audio" || activeMediaKind === "audioFeature") return audioRef.current;
  return null;
}

function resolveDuration(media: HTMLMediaElement): number {
  return Number.isFinite(media.duration) && media.duration > 0 ? media.duration : Number.MAX_SAFE_INTEGER;
}
