---
name: short-video-slot-library
description: build, search, validate, and recompose large short-video function-slot libraries made from many sample-video json exports. use when the user has slots, script atoms, rhythm atoms, packaging atoms, bindings, rules, templates, manifests, or many video-derived libraries and wants to select slots from the corpus, combine slots across samples, generate new slot chains, validate recomposed short-video structures, or design reusable short-video script/rhythm/packaging systems.
---

# Short Video Slot Library

## Core Position

Treat the uploaded data as a **multi-sample slot corpus**, not as one reusable video template.

The main object is the **slot library**:

`many sample videos -> many candidate function slots -> selectable slot chain -> compatible script/rhythm/packaging implementations -> binding validation -> new short-video plan`

Do not simply adapt one source video unless the user explicitly asks for a faithful variant.

## Conceptual Layers

1. **sample library**: one video's exported `manifest`, `slots`, `atoms.script`, `atoms.rhythm`, `atoms.packaging`, `bindings`, `rules`, and `templates`.
2. **corpus library**: many sample libraries merged or searched together.
3. **slot candidate**: one reusable function slot from one source video, with its compatible atoms and constraints.
4. **slot archetype**: a normalized slot type or higher-level role shared across many samples, such as `problem_activation`, `result_confirmation`, or `trust_close`.
5. **recomposition plan**: a new slot chain assembled from selected slot candidates, possibly from different sample videos.
6. **surface execution**: final script copy, rhythm curve, packaging plan, shot plan, and proof checklist.

## Essential Distinction

- Use **templates** as optional chain presets.
- Use **slots** as the unit of recomposition.
- Use **atoms** as implementations inside a slot.
- Use **bindings and rules** as compatibility constraints.
- Use **source videos** as evidence and inspiration, not as mandatory structure.

## Inputs

Accept any of these:

- A single sample-video export containing files such as `manifest.json`, `slots.json`, `atoms.script.json`, `atoms.rhythm.json`, `atoms.packaging.json`, `bindings.json`, `rules.json`, `templates.json`.
- A corpus of many sample-video exports in separate folders.
- A merged index created by `scripts/build_slot_index.py`.
- A target brief: category, audience, pain point, conversion goal, platform, duration, tone, proof assets, production constraints.
- A candidate slot chain, script, storyboard, or shot plan to validate and repair.
- A request to design the skill, schema, workflow, or library governance.

If multiple uploaded file sets exist, infer the latest complete set or ask only when the ambiguity blocks progress.

## Workflow Decision Tree

### Build or update a slot corpus

1. Validate each sample-video export.
2. Normalize source ids and file names.
3. Build a corpus index of slot candidates, atoms, bindings, templates, and rules.
4. Group candidates by `slotType`, claim type, proof need, rhythm pace, packaging function, confidence, and source sample.
5. Report coverage gaps and schema issues.

Use `scripts/validate_library_corpus.py` and `scripts/build_slot_index.py` when local JSON files are available.

### Recompose from a corpus

1. Normalize the target brief.
2. Decide the required viewer-state path and slot archetypes.
3. Retrieve candidate slots from the corpus for each archetype.
4. Select a slot chain with source diversity and binding compatibility.
5. Fill each selected slot with script, rhythm, and packaging implementations.
6. Add adapters when slots from different source videos need object, claim, proof, or rhythm bridges.
7. Validate bindings, proof functions, carryovers, and rhythm conflicts.
8. Produce a new script/rhythm/packaging/shot plan.

### Validate or repair a recomposed plan

1. Map the plan to slot archetypes.
2. Identify which selected slots and atoms it appears to use.
3. Check missing proof functions, broken carryovers, rhythm conflicts, and packaging-function loss.
4. Repair by replacing slots, changing atom implementations, adding bridges, or altering slot order.

### Design or improve the skill/library

1. Separate sample-level extraction from corpus-level retrieval.
2. Define slot candidate schema, corpus index schema, retrieval scoring, assembly rules, validation rules, and outputs.
3. Treat one uploaded sample as only a seed library.
4. Add procedures for deduplication, diversity, governance, and quality review.

## Corpus-Level Recomposition Order

Always use this order for multi-sample work:

1. **Brief normalization**: target product/category, viewer, pain, result, proof assets, length, platform, tone, constraints.
2. **Slot archetype planning**: infer the needed abstract slot types and viewer-state path.
3. **Candidate retrieval**: retrieve multiple slot candidates per archetype from the corpus.
4. **Candidate scoring**: score by functional fit, proof fit, rhythm fit, packaging fit, source diversity, confidence, and binding support.
5. **Chain assembly**: choose the final slot chain, allowing keep, delete, move, split, merge, duplicate, replace, or insert operations.
6. **Implementation selection**: select or adapt script, rhythm, and packaging atoms for each slot.
7. **Adapter creation**: bridge mismatches across source videos, such as different problem objects, proof objects, or rhythm expectations.
8. **Binding validation**: check sync, require, carryover, substitute, conflict, proof, and rhythm continuity.
9. **Output assembly**: generate script beats, rhythm plan, packaging plan, shot plan, proof checklist, and risks.

Never write polished copy before the slot chain and bindings are stable.

## Candidate Selection Rules

When choosing from a library, do not automatically pick the first matching slot type. Compare candidates.

Score each candidate against:

- **functional fit**: Does `persuasionTask` match the target viewer-state transition?
- **claim fit**: Does the script atom's `claimType` match the target claim?
- **proof fit**: Can available assets satisfy `proofNeed` and packaging function?
- **rhythm fit**: Does pace fit duration, platform, and information complexity?
- **packaging fit**: Does the packaging function match the needed proof, not merely the desired style?
- **binding support**: Are required sync/carryover/require rules available and usable?
- **confidence**: Prefer high confidence and non-review items; flag low-confidence choices.
- **source diversity**: Prefer multiple source videos unless intentionally making a faithful variant.
- **novelty**: Avoid recompositions that merely copy one original sample's full sequence.

## Mixing Slots Across Videos

It is valid to combine slots from different videos.

When mixing sources, explicitly create adapters:

- **object adapter**: connects opening problem object to later result object.
- **claim adapter**: translates one sample's claim type into the target category's claim.
- **proof adapter**: replaces unavailable proof with an equivalent proof function.
- **rhythm adapter**: smooths pace changes between adjacent slots from different sources.
- **packaging adapter**: preserves proof function while changing visual surface.

If no adapter can preserve the proof or carryover, do not use that candidate.

## Slot Operations

Use these operations to build a new structure:

- `keep`: use a candidate slot function as-is.
- `replace`: swap a candidate for another slot with the same or stronger function.
- `move`: change the slot's order.
- `insert`: add a slot not present in the source template.
- `delete`: remove a slot only if its proof or bridge is not required downstream.
- `split`: divide a high-load slot into smaller slots.
- `merge`: combine adjacent low-load slots.
- `duplicate`: repeat a slot with a different proof angle or audience angle.
- `fragment`: use only part of a slot, such as a trust proof fragment as an opening hook.

## Validation Rules

Hard checks:

1. Every selected slot must have a clear viewer-state transition.
2. Every major claim must have a proof function.
3. Opening concern and result proof must carry over or be explicitly bridged.
4. Mechanism claims need understanding time or a strong visual anchor.
5. Step and result should feel causally continuous unless the format intentionally separates them and adds a bridge.
6. Long-term trust claims need durable evidence: time, usage traces, repeated feedback, history, data, or equivalent.
7. Packaging surfaces may change, but packaging function cannot disappear.
8. Rhythm atoms must not violate `avoidFor` constraints without a repair.
9. Mixing source videos requires adapters for object, claim, proof, rhythm, or packaging mismatches.
10. If one source video contributes the entire chain, label the output as a faithful variant, not a library-level recomposition.

## Output Requirements

For corpus recomposition, output:

1. **重组目标与假设**
2. **候选检索逻辑**: what slot archetypes were needed and how candidates were chosen
3. **最终功能槽位链**: slot types, operations, source samples, and reasons
4. **槽位实现表**: script/rhythm/packaging atoms, adaptations, sync points, proof needs
5. **跨样例适配器**: object/claim/proof/rhythm/packaging bridges
6. **脚本草案**
7. **节奏曲线**
8. **包装与证明方案**
9. **绑定校验**
10. **风险与修复**
11. **可替换候选**: alternative slots or atoms from the library

For library-building tasks, output:

1. corpus structure
2. validation summary
3. index summary
4. slot archetype coverage
5. duplicate/near-duplicate findings
6. missing fields and enrichment suggestions
7. next extraction priorities

## References

Load these references only when needed:

- `references/concepts.md`: terminology and layer model.
- `references/corpus-ingestion.md`: how to validate and merge many sample-video exports.
- `references/retrieval-and-selection.md`: candidate retrieval, scoring, and source-diverse selection.
- `references/recomposition-workflow.md`: corpus-level recomposition patterns.
- `references/output-formats.md`: response templates and JSON output shapes.
- `references/quality-checks.md`: validation and failure modes.
- `references/sample-libraries/sample_001/`: a seed example library from one video only; never treat it as the whole corpus.

## Scripts

- `scripts/validate_library_corpus.py`: lightweight validator for one sample library or a corpus of sample libraries.
- `scripts/validate_corpus.py`: corpus validator that uses shared discovery helpers and can write a validation report.
- `scripts/build_slot_index.py`: build a merged searchable index with `canonicalSlots`, `slotVariants`, atom variants, bindings, rules, and templates.
- `scripts/retrieve_candidates.py`: retrieve and score slot variants from the merged index by brief, mode, category, and requested slot types.
- `scripts/assemble_plan.py`: generate a machine-readable recomposition skeleton from an index and brief.
- `scripts/retrieve_slot_candidates.py`: compatibility helper that can rank either `slotCandidates` or `slotVariants`.

Use scripts for deterministic file-level checks and index generation. Use reasoning for final creative recomposition.
