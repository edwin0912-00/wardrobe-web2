# Beta consolidation — 2026-07-30

Base: `c88561c` (current beta Fashion Shoot orb/progress UI).

Integrated:

- Chat 04 pose + subject-light atom, ported as `a5dac85`: each `shoot.*` slot
  keeps its runtime pose/focus/foreground directions and now also carries the
  style-specific subject-light interaction into the compiled reference pack.

Audited and already represented by equivalent or later content in the base:

- Block 01 core QA/persistence chain;
- Block 03 standard-background evidence repair;
- Block 02 Fashion Shoot refusal copy and action-label test;
- Block 05/06 Fashion Video capability, resolver, resume and Higgsfield parser;
- upload drag-and-drop and HEIC decoding;
- prior Action Hub and canonical orb UI atoms.

Not integrated:

- `7a76d8f` Live client crop experiment. It duplicates the current server-side
  hash-verified Live reference and can erase light garments; operator allowed
  it to be dropped.
- historic QA reports and stale/no-go cutout experiments. They contain no
  product capability and would make release history misleading.

Focused Fashion Shoot compiler tests pass after the Chat 04 port. No provider
generation ran for this consolidation.

weakened_checks: none.
