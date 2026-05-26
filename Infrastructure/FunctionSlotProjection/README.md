# FunctionSlotProjection

`FunctionSlotProjection` stores a queryable SQLite projection of `function-slot-atomization-analysis` artifacts.

The artifact JSON remains the source of truth. This projection is derived, rebuildable, and used only for search, filtering, and debugging lookup.

## Boundaries

- Projection rows must keep `artifactId`, `sampleVideoId`, and `traceId`.
- Source refs are for trace/debug lookup only, not for rebuilding business structures.
- `globalRiskIfBroken` is the general risk of breaking a binding. V1 does not model who broke the binding or context-specific risk.
- Full prompts, full source material, sensitive paths, and large raw media content must not be stored here.
