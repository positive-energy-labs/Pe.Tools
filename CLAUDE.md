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
- Name the proof lane. Source compile, package artifact, AttachedRrd, FreshRevitProcess, and installed behavior prove different things. Protect the user-owned RRD; SDK `pe-revit` owns live-loop orchestration.
- Delete a data-integrity or runtime seam only when the simpler replacement preserves its behavior and proof.

Read [AGENTS.md](AGENTS.md) for operating rules, [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for product direction, [docs/BUILD.md](docs/BUILD.md) for proof/runbook guidance, and the nearest package `AGENTS.md` before local changes.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `kaitpw/Pe.Tools` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default triage vocabulary (label string equals role name). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
