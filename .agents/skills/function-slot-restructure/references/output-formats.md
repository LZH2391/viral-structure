# Output formats

Use these formats for consistent responses.

## A. Corpus audit output

```markdown
# Corpus Audit

## Scope
- samples detected:
- slot variants:
- canonical slot types:
- atom variants:
- templates:
- rules/bindings:

## Strong areas
...

## Sparse areas
...

## Rule strength
| rule/function | support | confidence | note |
|---|---:|---:|---|

## Recommended library improvements
...
```

## B. Slot retrieval output

```markdown
# Slot Retrieval

## Target interpretation
...

## Candidate slots
| needed slot | selected candidate | source | why selected | risks |
|---|---|---|---|---|

## Alternate candidates
...

## Missing or weak coverage
...
```

## C. Recomposition output

```markdown
# Recomposition Plan

## 1. Target interpretation
[category, audience, goal, assumptions]

## 2. Slot demand graph
| demand | viewer transition | claim/proof obligation | hard edges | optionality |
|---|---|---|---|---|

## 3. Generated chain hypotheses
| hypothesis | sequence | operators used | why viable | risks |
|---|---|---|---|---|

## 4. Selected slot chain
| order | demand | slot type | operation | source/support | role |
|---:|---|---|---|---|---|

## 5. Slot-by-slot plan
### Slot 1: [slot type]
- script role:
- rhythm role:
- packaging/proof role:
- sync points:
- selected source variants:
- replacement variables:

## 6. Script draft / beat sheet
[usable segment-level script]

## 7. Rhythm curve
[fast/steady/pause/peak/close curve]

## 8. Packaging plan
[visual proof and overlay instructions]

## 9. Binding audit
| binding | status | note | repair if needed |
|---|---|---|---|

## 10. Variants
- A:
- B:
- C:
```

## D. Validation and repair output

```markdown
# Validation and Repair

## Mapping
| script/storyboard part | mapped slot | confidence |
|---|---|---:|

## Issues
| severity | issue | broken rule | repair |
|---|---|---|---|

## Repaired chain
...

## Repaired script/plan
...
```

## E. Library design output

```markdown
# Skill / Library Design

## Objective
...

## Data model
...

## Workflows
1. ingestion/indexing
2. retrieval/selection
3. recomposition
4. validation/repair
5. corpus improvement

## Required scripts
...

## Required references
...

## Output contracts
...
```
