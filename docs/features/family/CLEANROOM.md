# /family clean room — find-the-product living doc

Grill-driven redesign of /family, 2026-08-16. Prototype variants lived behind
`/family?variant=…` (`apps/web/src/family/proto/`, throwaway). All settled laws from rounds
1–5 (product reframe, lane law, cell-state law, ghost-row law, drift vocabulary, typing beats
proposing, materialize ceremony, role tokens, drill-in) now live in [LEDGER.md](LEDGER.md)
Decided; falsified paths are in Tried & rejected; the state-model gaps and builder friction
are Owed. This file carries only the open frontier.

## Open frontier

- **Geometry metadata exposure (round-3.5, user-flagged 2026-08-16).** The mocks flattened
  geometry to prose; the original route was already thin here. Required: editing a geometry
  constituent's metadata AND its parameter associations. Ghost-row law covers the
  param-BINDABLE properties; NON-bindable properties (direction, orientation, systemType,
  flowDirection, frame) live elsewhere — constituent focus → sidebar inspector editing,
  composed with the one-focus law. Fixture needs structured constituents (not strings) plus
  at least one unbound bindable dim.
- Saved/unsaved conveyance is still open (cell-state law fixed the other three overlays):
  candidates are a per-cell unsaved marker + the header dirty fact.
- Live-values overlay: whole-table toggle that visually replaces draft values (the LIVE
  column dies); drift must stay legible per cell under the overlay. Unbuilt.
- Materialize op path for one family (foundry apply with familyIds=[one] vs a new op) —
  after schema survivor work starts.
- /families UX revisit (user-flagged, separate exercise).
