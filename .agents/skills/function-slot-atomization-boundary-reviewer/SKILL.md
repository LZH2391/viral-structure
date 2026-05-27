---
name: function-slot-atomization-boundary-reviewer
description: Review function-slot-atomization analyzer final JSON for AtomCore, SourceTrace, Meta, and Mixed field-boundary violations. Use when checking function-slot-atomization.final.txt, AnalysisFinalOutputs finalMessage, or deciding whether atomization output is clean enough for structure library/recomposition use; do not rewrite the atomization result.
---

# Function Slot Atomization Boundary Reviewer

## Role

Review one `function-slot-atomization` final JSON for field-boundary correctness.

Use the finalMessage/final output as the review source, preferably:

```text
Artifacts/AnalysisFinalOutputs/<sampleVideoId>/function-slot-atomization.final.txt
```

Do not review SQLite projection tables, FunctionSlotLibrary exports, old reports, or upstream raw video. Do not re-run script/rhythm/packaging analysis. Do not rewrite the atomization JSON.

## Output Contract

Return only JSON:

```json
{
  "decision": "pass",
  "reason": "short reason",
  "issues": []
}
```

`decision` must be one of:

- `pass`: no field-boundary issue that would affect reuse/recomposition.
- `rework`: boundary issues exist and the analyzer output should be revised before reuse.
- `blocked`: input is missing, not valid JSON, or lacks enough structure to review.

Each issue must contain only:

```json
{
  "issue": "what boundary is wrong",
  "minimal_fix": "smallest useful correction",
  "field_paths": ["atom_inventory.script_atoms[0].semantic_function"]
}
```

Do not output `severity`, `type`, `score`, `coverage`, `findings`, `evidence`, `suggestion`, `shot_ids`, or any extra top-level fields.

## Field Roles

Use `outputContract.field_roles` if it is provided. If not provided, infer roles from the known analyzer schema.

### AtomCore

Reusable abstract structure. It includes slot names/types, viewer state transitions, persuasion tasks, atom labels/functions, proof needs, rhythm roles, packaging functions, binding rules, conflict reasons/fixes, recombination rules, and template sequences.

AtomCore should not contain current-sample specifics such as:

- concrete product/category: `护肤`, `泥膜`, `泥膜棒`
- concrete body/problem object: `鼻头`, `下巴`, `黑头`, `油光`
- concrete action instance: `上脸`, `涂抹`, `冲洗`, `等5分钟`
- concrete visual/evidence asset: `红白图卡`, `黄色动作字`, `时钟贴纸`, `空管`
- concrete shot names except inside SourceTrace

Report AtomCore leakage when concrete sample content makes the field less reusable.

### AtomCore.Graph

Structure references inside the reusable graph: `script_atom_ids`, `rhythm_atom_ids`, `packaging_atom_ids`, `slot_ids`, `atom_ids`.

These fields should contain existing structural ids only. Report if they contain prose, sample words, missing ids, or ids that do not exist in the same output.

### SourceTrace

Trace/evidence fields, mainly `source_refs`.

SourceTrace may contain concrete `shot_refs`, upstream segment labels, rhythm section labels, and packaging block labels. Report only when SourceTrace starts carrying abstract rules or business logic that should live in AtomCore.

### Meta

System/review state such as `confidence` and `need_review`. It must not contain business semantics.

### Meta.StructuralMeta

Stable structural identity fields: atom `id`, `slot_id`, binding `id`, rule `id`, `template_id`, and `source_binding_ids`.

Report only if these fields are missing, unstable, prose-like, or not usable as structural references.

### Mixed

Known mixed containers/fields: `atom_inventory`, `slot_map`, `binding_graph`, `replaceable_variables`, `visual_elements`, `replaceable_forms`, `risk`.

Mixed fields are not automatically wrong. Report them only when they hide a clear boundary problem, for example:

- `replaceable_variables` mixes abstract variable names and sample values in one item.
- `visual_elements` or `replaceable_forms` is used as the only place where packaging function is expressed.
- `risk` contains sample-specific commentary that should become SourceTrace evidence, while the structural risk is missing.

## Review Procedure

1. Parse the final JSON from the provided finalMessage/final output.
2. Identify the analyzer output object. It should contain `atom_inventory`, `slot_map`, `binding_graph`, `conflict_checks`, `recombination_rules`, and `recomposition_templates`.
3. Check AtomCore and AtomCore.Graph fields first; these are the main reuse blockers.
4. Check SourceTrace, Meta, and Mixed only for clear boundary misuse.
5. Group related fields into one issue when the same minimal fix applies.
6. Keep `issues` focused. Prefer a few high-signal issues over exhaustive word-by-word linting.

## Minimal Fix Style

Write fixes as reviewer instructions, not as a full replacement JSON.

Good:

```json
{
  "issue": "S001 semantic_function includes concrete body parts and action details, so an AtomCore field is tied to this sample.",
  "minimal_fix": "Rewrite it as an abstract function such as converting a high-attention problem object into an executable solution action; keep body parts/actions only in SourceTrace.",
  "field_paths": ["atom_inventory.script_atoms[0].semantic_function"]
}
```

Bad:

```json
{
  "issue": "not abstract enough",
  "minimal_fix": "fix all atoms",
  "field_paths": []
}
```

## Non-Goals

- Do not judge creative quality.
- Do not check whether the original video analysis is true.
- Do not repair the atomization output.
- Do not inspect database projection fields.
- Do not output long explanations or internal scoring.
- Do not force Mixed fields to be clean if the boundary problem is not actionable.
