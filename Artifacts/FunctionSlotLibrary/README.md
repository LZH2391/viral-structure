# FunctionSlotLibrary

This directory stores curated, Git-trackable exports of `functionSlotAtomizationAnalysis` artifacts.

Each item lives under:

```text
Artifacts/FunctionSlotLibrary/<artifactId>/
  manifest.json
  slots.json
  atoms.script.json
  atoms.rhythm.json
  atoms.packaging.json
  bindings.json
  rules.json
  templates.json
```

Boundary:

- Source of truth remains `Runtime/Artifacts/<sampleVideoId>/artifact.json`.
- This library is a reviewable structural export layer for diff, sharing, and controlled Projection import.
- `Runtime/Projection/function-slot-projection.sqlite` remains the local query index and is not tracked by Git.
- Exports must not include full prompts, DebugSnapshots, input packages, videos, frames, or local absolute paths.
