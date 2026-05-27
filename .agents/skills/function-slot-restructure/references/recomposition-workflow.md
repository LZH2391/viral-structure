# Recomposition workflow

Use this workflow to create a new short-video plan from a multi-video slot library.

## Step 1: Define the target viewing path

Write the intended viewer-state progression before selecting samples.

Example:

```text
unaware -> sees exact work pain -> sees quick action -> understands why it works -> sees output -> trusts it for repeated use -> knows what to choose
```

Translate this into candidate slot types.

## Step 2: Choose a slot-chain strategy

Choose one strategy before retrieving candidates.

### Faithful demo chain

```text
problem_activation -> mechanism_credibility -> low_barrier_operation -> result_confirmation -> trust_close
```

Use for demonstrable products where the original structure fits.

### Result-first hook

```text
result_confirmation -> problem_activation -> operation -> mechanism_or_proof -> trust_close
```

Use when the strongest retention asset is the result, not the pain point.

### Trust-first review

```text
trust_proof -> problem_activation -> mechanism -> result -> choice_close
```

Use when creator credibility or long-term proof is the strongest asset.

### Compressed conversion

```text
problem_activation -> operation_result_combo -> choice_close
```

Use for 8-15 second videos.

### Education-first structure

```text
misconception_or_mistake -> mechanism -> demonstration -> result -> action
```

Use for knowledge-led selling or creator authority.

## Step 3: Retrieve candidates per slot

For each slot type, retrieve at least 2 candidates when the corpus allows it. Compare:

- viewer-state fit
- proof requirements
- rhythm feasibility
- packaging feasibility
- source reliability
- category/style distance from target

If a slot type has no candidate, generate a new slot implementation but mark it as outside-library generated.

## Step 4: Select implementation mix

For each slot, decide whether to:

- use a full slot variant from one sample
- keep the slot variant but swap script atom
- keep script but swap rhythm
- keep script and rhythm but swap packaging
- generate a new implementation using the canonical slot definition

Good recomposition often mixes at least two source samples, but not at the cost of breaking bindings.

## Step 5: Check cross-slot dependencies

Common dependencies:

- problem slot must be paid off by result slot
- operation slot must be close enough to result slot for attribution
- mechanism slot must not interrupt an urgent hook unless visually anchored
- trust slot must use proof that is relevant to the claim, not generic credibility
- close slot must point to a concrete choice, action, or memory object

## Step 6: Design the rhythm curve

Create a video-level rhythm curve after the slot chain is chosen.

Examples:

```text
fast problem hit -> steady explanation -> pause/action -> result peak -> proof close
```

```text
result peak -> rewind explanation -> stable proof -> decisive close
```

Rhythm may cross slot boundaries. Represent this explicitly:

```text
low_barrier_operation + result_confirmation = pause -> action -> payoff
```

## Step 7: Design packaging by proof function

For each claim, assign proof packaging.

```text
problem claim -> object/concern visibility
mechanism claim -> explanation proof
operation claim -> step/completion proof
result claim -> before/after or output proof
trust claim -> time, repetition, social proof, usage trace
choice close -> product/service/action memory point
```

## Step 8: Produce a practical plan

Output a usable plan rather than abstract theory:

- segment-level copy
- shot or screen-recording actions
- packaging overlays
- rhythm timing
- proof materials needed
- binding checks
- alternate versions

## Step 9: Label confidence

Confidence should reflect corpus support and target fit.

High confidence:

- chain is supported by multiple samples or logical necessity
- proof assets exist
- atoms are compatible
- bindings pass

Medium confidence:

- chain is supported but category differs
- proof assets are partial
- one or two generated implementations are needed

Low confidence:

- mostly generated from sparse library data
- missing proof assets
- major binding risks remain
