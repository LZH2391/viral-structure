# Retrieval and selection

Use this reference when choosing slots and atoms from a multi-video library.

## Selection order

Select in this order:

1. **canonical slot chain**: which viewer-state transitions are needed
2. **slot variants**: which source examples best match each needed slot
3. **script atoms**: which claim implementation fits the target
4. **rhythm atoms**: which attention pattern fits the claim and duration
5. **packaging atoms**: which proof/visual implementation fits available assets
6. **bindings and rules**: what must be synchronized, carried over, or avoided

Do not retrieve a packaging style first and then force a slot around it.

## Candidate scoring

Score candidates qualitatively or with scripts. Use this hierarchy:

### 1. Function fit

Does the candidate slot produce the desired viewer-state transition?

High fit if:

- `viewerStateBefore` and `viewerStateAfter` match the target point in the chain
- `persuasionTask` matches the target objective
- the slot's required sync points are feasible

### 2. Claim and proof fit

Does the candidate have proof needs that the target can satisfy?

Examples:

- mechanism claim needs mechanism explanation or visual proof
- operation claim needs step cue and completion action
- result claim needs result evidence tied to earlier concern
- long-term trust claim needs time evidence, usage traces, reviews, logs, or repeated feedback

### 3. Rhythm fit

Does the rhythm support the amount of information?

Examples:

- fast staccato fits problem activation, not complex mechanism
- steady dense fits explanation
- pause-then-action fits step-to-result transitions
- slow testimonial fits trust close

### 4. Packaging fit

Does the packaging function fit the claim and the target production resources?

Choose proof function before visual style.

Examples:

- problem location -> close-up, highlight, cursor circle, crop, comparison frame
- mechanism -> diagram, overlay, screen annotation, demo cutaway
- step -> icon, countdown, checklist, gesture, interface pointer
- result -> before/after, output screen, close-up, number change
- trust -> record, repeated proof, usage trace, testimonial, review, receipt, usage log

### 5. Reliability

Prefer variants with:

- higher confidence
- no `needReview`
- repeated slot type support across samples
- rules repeated across multiple samples
- clear source references

### 6. Diversity

Avoid building a new video entirely from one source sample unless the user asks for a faithful variant.

Prefer a mix such as:

- slot chain from a high-support template
- script atom from a close category
- rhythm atom from a similar duration/style
- packaging atom from a sample with the right proof assets

## Retrieval modes

### Exact slot retrieval

Use when the user asks for a specific slot type.

Output:

- top candidate slot variants
- their source samples
- script/rhythm/packaging options
- proof requirements
- risks

### Chain retrieval

Use when the user asks to make a new video.

Output:

- recommended slot chain
- why it fits the target
- slots borrowed from the library
- slots generated or inserted because the library lacks them

### Gap-aware retrieval

Use when the corpus lacks examples.

Output:

- available library candidates
- missing slot or atom types
- generated fallback implementation
- confidence downgrade

## Slot mixing rules

You may mix script, rhythm, and packaging atoms from different videos if:

- they share the same or compatible slot type
- the script proof need is satisfied by the packaging atom
- the rhythm does not list the script claim type in `avoidFor`
- required sync points can be aligned
- cross-slot carryover remains intact

Do not mix atoms merely because their labels sound similar.

## Example selection explanation

```text
Selected problem_activation from sample_014 because its viewer-state shift matches the target opening and it has strong object-action sync. Used rhythm from sample_006 because the target is a 12-second video and needs faster entry. Replaced packaging with a screen-recording highlight from sample_021 because the target is SaaS, not skincare. Binding check passes because problem object, cursor highlight, and action click can land on the same beat.
```
