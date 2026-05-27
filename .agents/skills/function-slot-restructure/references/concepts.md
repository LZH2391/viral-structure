# Concepts

Use this reference when explaining or applying the library-level model.

## One Video vs Corpus

A single exported video gives one sample library. A production system will contain many sample libraries. The skill must avoid overfitting to one source.

- **sample library**: data extracted from one video.
- **corpus library**: many sample libraries searched together.
- **slot candidate**: one function slot from one sample video.
- **slot archetype**: normalized reusable role shared by many candidates.
- **template**: one possible ordering of slot archetypes.

A sample's template can inspire a chain, but corpus recomposition should compare multiple candidates and mix sources when useful.

## Slot vs Atom vs Template

- A **slot** answers: what viewer-state transition must happen?
- A **script atom** answers: what claim or semantic move implements the slot?
- A **rhythm atom** answers: how should attention move through the slot?
- A **packaging atom** answers: how is the claim made visible, credible, and memorable?
- A **binding** answers: what must be synchronized, required, carried over, substituted, or avoided?
- A **template** answers: what slot order is useful for a recurring pattern?

## Recomposition Unit

The main recomposition unit is not a script paragraph. It is a selected slot candidate plus compatible implementations.

```text
slot candidate
  -> script implementation
  -> rhythm implementation
  -> packaging/proof implementation
  -> bindings and adapters
```

## Slot Archetypes

A corpus should accumulate many candidates for each archetype, such as:

- problem activation
- contradiction hook
- result proof hook
- mechanism credibility
- operation simplification
- comparison or objection handling
- result confirmation
- benefit translation
- social proof
- long-term trust
- decision or choice close

Archetypes can be extended as more samples are added. Do not force all videos into one fixed five-slot model.

## Adapters

Adapters are needed when combining material from different source videos.

- **Object adapter**: maps the opening object or concern to the result object.
- **Claim adapter**: maps the original product claim to the target product claim.
- **Proof adapter**: replaces a source proof carrier with an equivalent proof function.
- **Rhythm adapter**: changes pace or adds a bridge between mismatched adjacent slots.
- **Packaging adapter**: changes visual surface while keeping proof function.

## Library-Level Goal

The goal is not to preserve one video's structure. The goal is to select the best slot candidates from the corpus for a new target brief while preserving proof logic and attention logic.
