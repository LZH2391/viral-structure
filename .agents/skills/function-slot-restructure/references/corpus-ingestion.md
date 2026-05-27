# Corpus Ingestion

Use this reference when the user has many video-derived JSON exports.

## Expected Directory Forms

Preferred corpus form:

```text
corpus/
  sample_001/
    manifest.json
    slots.json
    atoms.script.json
    atoms.rhythm.json
    atoms.packaging.json
    bindings.json
    rules.json
    templates.json
  sample_002/
    ...
```

Flat upload form is also acceptable if file names contain sample ids. Normalize into sample folders before indexing when possible.

## Minimum Complete Sample

A sample is usable for retrieval when it has:

- slots
- at least one atom type, preferably all three
- bindings or rules
- manifest or detectable sample id

If templates are missing, derive candidate chains from `slotOrder` and `slotType`.

## Corpus Index Fields

A merged index should contain:

```json
{
  "schemaVersion": "slot_corpus_index.v1",
  "samples": [],
  "slotVariants": [],
  "atomCandidates": [],
  "bindings": [],
  "rules": [],
  "templates": [],
  "coverage": {}
}
```

Each `slotVariants` record should include:

- `variantId`: stable id such as `sample_001::F001`
- `sampleId`
- `sourceSlotId`
- `slotType`
- `slotName`
- `viewerStateBefore`
- `viewerStateAfter`
- `persuasionTask`
- `scriptAtomIds`
- `rhythmAtomIds`
- `packagingAtomIds`
- `requiredSyncPoints`
- `substitutionRules`
- `confidence`
- `needReview`
- `searchText` or equivalent normalized text for retrieval

## Deduplication

Do not delete near-duplicates immediately. Group them.

Useful duplicate keys:

- same `slotType` + highly similar `persuasionTask`
- same `claimType` + same `proofNeed`
- same `pace` + same `beatShape`
- same `packagingFunction`

Keep source diversity because two near-duplicate slots may provide different proof carriers or packaging surfaces.

## Coverage Review

After indexing, report:

- number of samples
- number of slot variants by slot type
- atom counts by type
- templates by sequence
- missing fields
- low-confidence or review-needed candidates
- under-covered slot archetypes
- over-represented source videos or formats

## Enrichment Recommendations

When data is too thin, enrich with:

- category tags
- platform tags
- product type
- duration range
- proof asset type
- hook type
- CTA style
- production complexity
- emotional tone
- performance metadata if available
