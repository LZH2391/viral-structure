# Recomposition workflow

Use this workflow to create a new short-video plan from a multi-video slot library. The key idea is: **do not choose a preset strategy first**. Recomposition is a constrained assembly problem.

A template can be evidence that a chain worked in one sample. It is not the generator of the new chain.

## Step 1: Normalize the target brief into constraints

Before retrieving slots, extract the target constraints.

Required fields to infer or ask for only if blocking:

- **viewer start state**: what the viewer believes or feels before the video begins
- **viewer end state**: what the viewer should believe, feel, or do after the video
- **problem object**: the concrete object/scene/symptom/friction to activate
- **solution action**: what the product/method/person does visibly
- **desired result**: the payoff that proves the action mattered
- **choice object**: what the viewer should remember or choose at the end
- **available proof assets**: demo, screen recording, before/after, numbers, logs, testimonials, long-term records, object traces, comments, receipts, etc.
- **objections**: why the viewer might doubt, delay, or misunderstand
- **duration and platform constraints**: time budget, density, creator style, required CTA strength
- **production constraints**: what can be filmed, shown, overlaid, or claimed

Output this as a `brief_constraints` object. Do not yet select a chain.

## Step 2: Build a slot demand graph, not a strategy

This is the most important step.

The output of Step 2 is a **slot demand graph**: a set of needed viewer-state transitions plus constraints between them. It is not a choice among `result-first`, `trust-first`, `compressed`, or any other preset.

### 2.1 Create claim and proof inventory

List every claim the new video must make. For each claim, decide what proof function can support it.

```text
problem claim      -> problem visibility / concern evidence
action claim       -> visible action path / interface action / behavior proof
mechanism claim    -> reason, process, comparison, cutaway, or explanatory proof
operation claim    -> step cue + completion proof
result claim       -> output, before/after, close-up, number change, or status change
benefit claim      -> life/work scenario translation
trust claim        -> time evidence, usage trace, review, repeated feedback, log, receipt, testimonial
choice claim       -> concrete product/service/action memory point
```

Each claim becomes a potential slot demand only if it is needed for the target viewer-state path. Do not include a slot because it exists in the source sample.

### 2.2 Convert claims into demand nodes

Each demand node should contain:

```json
{
  "demandId": "D01",
  "targetViewerStateBefore": "viewer state before this transition",
  "targetViewerStateAfter": "viewer state after this transition",
  "slotRole": "abstract role, e.g. problem_activation or result_confirmation",
  "claimType": "problem_to_action | mechanism_explain | operation_simplification | result_to_benefit | trust_to_choice | ...",
  "proofFunction": "what kind of proof must appear",
  "informationLoad": "low | medium | high",
  "rhythmNeed": "hook | steady_explain | pause_action | payoff_peak | proof_close | ...",
  "packagingNeed": "object_visibility | mechanism_visualization | step_prompt | result_proof | trust_trace | choice_memory | ...",
  "requiredCarryovers": ["object", "claim", "proof", "choice"],
  "optionality": "required | optional | conditional",
  "priority": 1
}
```

Examples:

- If the target has a visible usage action and a result, create an operation/result demand pair and mark them as causally close.
- If the target has a novel or non-obvious mechanism, create a mechanism demand and require understanding time or a strong visual anchor.
- If the target has strong proof but weak visible action, create a trust/proof demand and use it either as a hook fragment or a close, depending on viewer state.
- If duration is very short, keep the same demand nodes but mark adjacent nodes as mergeable; do not simply switch to a canned compressed chain.

### 2.3 Add graph edges

Add constraint edges between demand nodes:

```json
{
  "from": "D01",
  "to": "D04",
  "edgeType": "carryover | causal_precede | proof_payoff | rhythm_continuity | requires_bridge | conflict | alternative | mergeable | hookable",
  "constraint": "result proof must return to the problem object activated in D01",
  "hardness": "hard | soft"
}
```

Core edges to consider:

- `carryover`: opening object/concern must be paid off by result or proof.
- `causal_precede`: operation must appear before result unless result is intentionally used as a hook and later explained.
- `proof_payoff`: a claim must have a proof slot or proof packaging.
- `rhythm_continuity`: a pause/action node should flow into the payoff node if result attribution matters.
- `requires_bridge`: moving a slot away from its usual neighbor requires an adapter.
- `conflict`: high-information mechanism cannot be placed inside a fast hook without visual anchoring.
- `alternative`: two demand nodes solve the same persuasion problem; choose one or merge.
- `mergeable`: adjacent nodes can be combined if proof functions survive.
- `hookable`: a proof/result/trust fragment can be moved to the opening.

### 2.4 Output of Step 2

Step 2 must output something like this before candidate retrieval:

```json
{
  "brief_constraints": {...},
  "slot_demand_graph": {
    "nodes": [...],
    "edges": [...],
    "mustSatisfy": ["problem result carryover", "proof for every major claim"],
    "softPreferences": ["source diversity", "low production complexity"]
  }
}
```

This graph is the real recomposition target. Preset chain names should not appear here.

## Step 3: Generate chain hypotheses from graph operators

Generate several chain hypotheses by applying operators to the demand graph. This is where recomposition happens.

Do not ask: "Which strategy should I choose?"

Ask:

1. Which demand node should open the video given the strongest available hook asset?
2. Which nodes must stay adjacent for causality or proof attribution?
3. Which nodes can be merged without losing proof function?
4. Which nodes can be fragmented and reused as a hook or close?
5. Which nodes need an adapter if moved away from their source context?

### Chain-generation operators

Use these operators, alone or in combination:

- `anchor`: choose the opening demand node based on strongest hook asset, not a preset.
- `move`: reorder a node while preserving hard edges with adapters.
- `insert`: add a missing demand needed by the target, even if the source template lacks it.
- `delete`: remove a demand only when its claim is unnecessary or proven elsewhere.
- `split`: divide an overloaded node into two lighter nodes.
- `merge`: combine adjacent nodes when proof functions remain visible.
- `duplicate`: repeat a slot role with different proof angle, e.g. quick result hook and later detailed result proof.
- `fragment`: use part of a slot as a hook, bridge, or closing memory point.
- `invert`: show payoff first, then explain source/cause later.
- `contrast`: add an old-way/new-way or before/after comparison node.
- `ladder`: stack proof from weak-to-strong, e.g. demo -> result -> long-term trace.
- `bridge`: create an adapter node between mismatched source candidates.

### Chain hypothesis format

```json
{
  "chainId": "H01",
  "sequence": ["D04", "D01", "D03", "D04_detail", "D05"],
  "operatorsUsed": ["fragment", "invert", "duplicate"],
  "reason": "strong result proof is the best hook, but detailed result proof must still return after operation",
  "hardEdgesSatisfied": ["D01 -> D04 carryover", "D03 -> D04 causal payoff"],
  "requiredAdapters": ["object adapter from result hook back to problem object"],
  "risks": ["if result hook is too disconnected, add rewind bridge"]
}
```

Generate 2-5 chain hypotheses when the target is open-ended. Keep at least one conservative chain and one non-obvious chain if the corpus/proof assets support it.

## Step 4: Retrieve candidates against demand nodes, not just slot names

For each demand node, retrieve candidates by:

- slot role or compatible slot type
- viewer-state transition match
- claim type and proof need
- rhythm need and information load
- packaging proof function
- required sync/carryover constraints
- source reliability and confidence

A candidate with the right label but wrong proof function should lose to a candidate with a weaker label but stronger function fit.

If no library candidate satisfies a required demand, create a generated gap-fill implementation and lower confidence.

## Step 5: Select globally, not slot-by-slot

Do not pick the top candidate for each slot independently. Choose the combination that works as a chain.

Score the full plan by:

- **state coverage**: every important viewer-state transition is covered
- **proof satisfaction**: each major claim has a feasible proof function
- **carryover integrity**: opening object/concern connects to result, trust, or choice
- **causal clarity**: action, mechanism, and result do not feel disconnected
- **rhythm coherence**: the video has a purposeful attention curve
- **packaging feasibility**: visual proof can actually be produced
- **binding compatibility**: sync, require, carryover, substitute, and conflict rules pass
- **source diversity**: the plan is not just one source sample unless intentionally faithful
- **novelty with control**: the plan is different enough to be useful but still explainable

When many candidates exist, use a beam-search mindset:

1. Keep the top few chain hypotheses.
2. For each demand node, keep the top few candidates.
3. Combine only candidates that satisfy hard edges.
4. Prefer the plan with the best global score, not the highest local candidate score.

## Step 6: Compose slot implementations

For each selected demand node, decide the implementation source:

- use a full slot candidate
- keep the slot function but swap script atom
- keep script but swap rhythm
- keep script/rhythm but swap packaging
- use a proof fragment from another slot
- generate a missing implementation from the demand definition

Always explain what is preserved:

```text
preserved function: result proof returns to activated problem object
changed surface: skincare close-up -> dashboard before/after screen
```

## Step 7: Create adapters for cross-source or cross-category gaps

Adapters are not decoration; they are the bridge that makes mixed-source recomposition coherent.

Use adapters when:

- the problem object and result object differ
- a claim is borrowed from one category but proof assets come from another
- rhythm changes abruptly between source candidates
- packaging style changes but proof function must stay intact
- a slot is moved before the node that normally explains it

Adapter types:

- `object_adapter`
- `claim_adapter`
- `proof_adapter`
- `rhythm_adapter`
- `packaging_adapter`
- `time_adapter`
- `causal_adapter`

## Step 8: Design the video-level rhythm curve

Only design the rhythm curve after the demand graph and chain hypothesis are stable.

Represent rhythm across slots:

```text
hook spike -> quick clarification -> steady proof -> pause/action -> payoff peak -> trust decay/close
```

Rhythm may cross slot boundaries. Represent this explicitly:

```text
low_barrier_operation + result_confirmation = pause -> action -> payoff
```

Check information load: dense mechanism, multi-step operation, and trust proof usually need more time than problem visibility or result flash.

## Step 9: Design packaging by proof function

For each claim, assign proof packaging based on function before style.

```text
problem claim -> object/concern visibility
action claim -> direct action path
mechanism claim -> explanation proof
operation claim -> step/completion proof
result claim -> before/after, output, or close-up proof
benefit claim -> scenario translation
trust claim -> time, repetition, social proof, usage trace
choice close -> concrete memory point
```

Surface style can change. Proof function cannot disappear.

## Step 10: Produce the practical plan and audit

Output a usable plan rather than abstract theory:

- brief constraints
- slot demand graph
- generated chain hypotheses and selected chain
- selected slot candidates and source samples
- slot-by-slot script/rhythm/packaging implementation
- adapters
- segment-level copy
- shot or screen-recording actions
- overlays and proof packaging
- rhythm timing
- proof materials needed
- binding checks
- alternate versions

## Step 11: Label confidence

Confidence should reflect corpus support and target fit.

High confidence:

- demand graph is clear
- chosen chain satisfies hard edges
- proof assets exist
- selected candidates have compatible atoms and bindings
- key patterns are supported by multiple samples or strong logic

Medium confidence:

- chain is coherent but category differs
- proof assets are partial
- one or two generated implementations or adapters are needed

Low confidence:

- mostly generated from sparse library data
- missing proof assets
- major binding or carryover risks remain
- final chain depends on an untested operator combination
