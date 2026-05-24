---
name: shot-boundary-v2-analyzer
description: Given only the original video path and an agent work directory, generate whatever frame sheets/evidence are needed with tools, inspect them, and return final shot boundaries in one turn.
---

# SKILL: Shot Boundary V2 Agent-Driven Analyzer

You are not reviewing an existing project shot analysis. You are doing your own shot-boundary analysis from the original video.

## Inputs

The turn prompt provides:

- `manifest.video.sourceVideoPath`: absolute path to the original video.
- `manifest.video.evidenceOutputDir`: directory where you may write scratch frames, contact sheets, candidate sheets, logs, or JSON.
- `manifest.durationSeconds`: target final video duration.
- `outputContract`: the exact JSON shape to return.

Do not read or rely on existing `shotBoundaryAnalysis`, history, cache, reviewer output, or project-generated V1 sheets. Use only the source video and files you create under `evidenceOutputDir`.

## Tool Workflow

Use `shell_command` as needed. You decide what to generate.

Recommended process:

1. Run `ffprobe` on `sourceVideoPath` to confirm duration, FPS, width, and height.
2. Run one or more `ffmpeg` scene-score passes and/or frame-diff passes to discover possible boundary times.
3. Generate overview contact sheets under `evidenceOutputDir` as needed.
4. Generate denser sheets around ambiguous intervals as needed.
5. For candidate verification, use exactly these frame positions: `t-3f`, `t-1f`, `t`, `t+1f`, `t+3f`.
6. When a command creates an image you need to inspect, print this line on its own line so the runtime attaches the image to the tool result:

```text
LOCAL_IMAGE: C:\absolute\path\to\sheet.jpg
```

You may print multiple `LOCAL_IMAGE:` lines. Keep generated files inside `evidenceOutputDir`.

## Boundary Standard

- Count hard cuts, obvious jump cuts, transitions, and abrupt subject/scene/composition changes.
- Do not count same-camera continuous talking, handheld drift, product close-up motion, hand movement, subtitle/sticker changes, exposure shifts, compression artifacts, or continuous zoom/pan as shot cuts.
- High scene score or high frame difference is only a candidate. Confirm visually with generated sheets before accepting.
- If you reject a high-change moment that could be questioned, include it in `rejectedCandidates` with a short reason.

## Output

Return only one JSON object. No markdown, explanations, local file paths, frame IDs, old-shot references, or prose outside the JSON.

Rules:

- First shot `start` must be `0`.
- Last shot `end` must equal `manifest.durationSeconds`.
- Last shot `endBoundary` must be `null`.
- Adjacent shots must be contiguous: each `start` equals the previous `end`.
- Every non-final `endBoundary.timestamp` must equal that shot's `end`.
- `confidence` is a number from `0` to `1`.
