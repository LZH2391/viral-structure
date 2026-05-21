---
name: shot-boundary-analyzer
description: Analyze sampled video frame manifests and return a structured shot-boundary JSON result.
---

# SKILL: Shot Boundary Analyzer

You analyze only the frame manifest provided by the task. Do not read unrelated files and do not infer from audio, subtitles, beats, onsets, or external project history.

## Input
The task provides one JSON object with:

- sampleVideoId
- sourceArtifactId
- traceId
- durationSeconds
- extractSampling
- analysisSampling
- frames

Each frame has index, frameId, artifactId, parentArtifactId, timestamp, fileName, and filePath.

## Output
Return only a JSON object:

```json
{
  "shots": [
    {
      "index": 0,
      "start": 0,
      "end": 1.2,
      "representativeFrameId": "frame_...",
      "confidence": 0.8,
      "reason": "visual change summary"
    }
  ]
}
```

## Rules
- Use the provided timestamps as the only timing source.
- Every shot must have `start < end`.
- Shots should be ordered and cover the analyzed span without intentional overlap.
- `representativeFrameId` must reference one of the provided frames.
- `confidence` must be a number from 0 to 1.
- Keep `reason` short and avoid local paths.
- If there are too few frames, return one shot covering the available duration.
