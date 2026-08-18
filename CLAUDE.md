# Pe.Tools

Pea is a Revit operator and a builder of shareable Pods. Optimize its public surfaces for agent experience: typed, discoverable, observable, bounded, and progressively explorable.

## Product posture

- Make the relevant world smaller and more trustworthy; do not solve uncertainty by dumping tools, prompt text, or stale context.
- One capability gets one progressively discoverable path. Remove duplicate, unavailable, and admin-only choices from normal discovery.
- Libraries own Revit/domain meaning. Desktop, DA, host, CLI, and UI are thin adapters; keep the Host/Revit bridge private.
- C# DTOs and operation metadata, plus the live connected-host catalog, are public-contract authority. Generated schemas, clients, and UI are projections—not parallel truth.
- Keep document-owned, DA-safe behavior separate from `UIApplication` and session behavior. Desktop and DA are sibling shells.
- Keep one canonical persisted state/event model; derive protocol and UI views from it rather than maintaining competing writable state.
- Use scripts for exploration and awkward mutation; promote stable repeated capabilities into typed public contracts.
- Default to safe, inspectable action. Agents propose; users retain approval, edit, staging, and rejection control. Full mutation is explicit.
- Treat Revit metadata, wrapper identity, and positional correspondence as untrusted until real behavior proves them. Treat project models as adversarial input; preserve coordinate frames and stable identities.
- Surface provenance and uncertainty explicitly. Spatial/model claims need inspectable, freshness-aware visual or behavioral evidence; plausible counts are not proof.

## Engineering posture

- This is greenfield: favor linear, fail-fast, explicit, type-safe code and delete stale code/docs. Do not preserve compatibility shims except as short compile bridges.
- Keep deterministic sequencing, validation, safety, and freshness in the harness; put reusable judgment-heavy workflows in skills and changing maps in generated artifacts.
- Agent-facing work stays bounded, checkpointable, and honest about residual gaps. A timeout is a diagnostic boundary, not a blind retry.
- Long time on task or unprogressing loops warrant a look at underlying problems. Time on task for subagents in particular reveal high "this architecture is bad" signal, in part becasue your context is not contaminated with the implementation history.
- Name the proof lane. Source compile, package artifact, AttachedRrd, FreshRevitProcess, and installed behavior prove different things. Protect the user-owned dev session; SDK `pe-revit` owns execution-loop orchestration.
- Delete a data-integrity or runtime seam only when the simpler replacement preserves its behavior and proof.

Read [AGENTS.md](AGENTS.md) for operating rules, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for product direction, [docs/BUILD.md](docs/BUILD.md) for proof/runbook guidance, and the nearest package `AGENTS.md` before local changes.

## Agent skills

### Docs conventions

No external issue tracker. Durable knowledge lives in feature ledgers (`docs/features/<name>/LEDGER.md`), ADRs (`docs/adr/`), authority docs, and disposable handoffs (`.artifacts/handoffs/`). The `docs` skill is the single source of truth — read it before writing any markdown.

### Product surfaces

`docs/design/SURFACE-PHILOSOPHY.md` holds what our UI surfaces are for and how they behave; the `find-the-product` skill is the loop that produces and updates it. The live design frontier — rulings, gaps, and owed work for the one-system design cluster — lives at `docs/features/design-system/LEDGER.md`; the `/design-system` route is the executable design authority.

### Domain docs

Glossaries are scoped: package terms in that package's `AGENTS.md` Shared Language table, feature terms in `docs/features/<name>/GLOSSARY.md` (lazy). ADRs in `docs/adr/`. The `domain-modeling` skill owns both.
