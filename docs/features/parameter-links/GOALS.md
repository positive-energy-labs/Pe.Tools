# Parameter Links MVP

## Intent

Parameter Links keeps a target Revit parameter synchronized from one or more source parameters. The first product case is equipment MOCP to electrical-circuit Rating, but the core must not encode MOCP, panel schedules, or a particular family parameter.

The feature is agent-first: Pea should inspect, propose, preview, persist, and reconcile a complete linkage through a very small public surface. Browser and chat UI use the same vocabulary and operations.

## Shared Language

- **Profile**: the versioned, model-owned set of definitions and assignments.
- **Definition**: source selector, relationship, target selector, and reducer.
- **Assignment**: enables a definition for all matching source elements or a selected set of source unique ids.
- **Relationship**: maps source elements to target elements. MVP ships `sameElement` and `electricalEquipmentCircuits`.
- **Reducer**: resolves multiple source values for one target. MVP ships `first`, `min`, and `max`.
- **Evaluation**: proposed target writes plus issues; it is side-effect free.
- **Reconcile**: evaluate, compare, and write only changed targets.

## Phase 1: Core

1. Store one versioned JSON profile in one non-visible shared Text parameter bound to Project Information. Do not use Extensible Storage. Missing or malformed data fails closed.
2. Resolve parameters by the existing portable parameter identity contract. Preserve native storage values; numeric reducers operate on internal Revit values.
3. Keep evaluation deterministic and independent of transactions. Explicit apply owns its transaction; the updater writes inside Revit's updater context.
4. Register one process-wide `IUpdater`. Resolve document-specific profile/runtime state through the SDK document tracker. Source changes trigger a compare-before-write reconcile; explicit apply is the full-reconcile fallback.
5. Expose exactly two feature host operations:
   - `revit.detail.parameter-links`: return the stored profile, evaluation, issues, and runtime status.
   - `revit.apply.parameter-links`: optionally replace the whole profile and preview or reconcile it atomically.
6. Reuse those contracts and terms in C#, generated host contracts, route state, UI, and agent guidance. Add no parameter-link-specific MCP tool.

The first acceptance case is a `max` definition from an Electrical Equipment current parameter through `electricalEquipmentCircuits` into each circuit's writable Rating value.

## Phase 2: Routes As Chat Plugins

Add `route:parameter-links` to the existing route-state protocol. Its document is a collaborative draft/status projection, never durable authority. The agent write mask permits draft proposals; route commands perform refresh, preview, and explicit apply through the same host operations.

Add one generic assistant-ui route-plugin registry. When a generic `route_state_read`, `route_state_apply`, or `route_command` call identifies a registered route, chat renders that route's live inline UI. Parameter Links is the first full inline plugin; Family Types may register through the same seam without changing its protocol.

Preview and apply carry the complete reviewed profile through the existing route-command input. Apply fails when that profile no longer matches the live draft, so a later agent patch cannot silently change the human-reviewed write. The dock reads route slices from the Workbench's existing session-state SSE projection; its initial GET is only a cold-start fallback.

The `plugin=family-types` query parameter is a separate pilot for hosting an existing full route page in a right-side workspace lane. It intentionally reuses the Family Types route and state protocol through an iframe; it is not a second plugin registry or route-state implementation. Keep this narrow until direct route composition in chat has a proven identity and navigation model.

Do not add feature-specific agent tools, a second chat transport, or a second route-state implementation.

## Stop Before Phase 3

Do not hide host operations, require all mutations to pass through routes, add office/shared profile libraries, add a formula language, or migrate every existing route. Those decisions require evidence from the MVP.

## Safety And Proof

- Reject missing definitions, duplicate ids, direct self-links, incompatible values, read-only targets, and unsupported relationships as structured issues.
- Never open or restart RRD. Use `pe-revit sandbox` for an isolated interactive runtime and `pe-revit test fresh` for Revit-backed proof.
- Prove deterministic evaluation in ordinary tests and prove model storage plus the MOCP-to-Rating path in FreshRevitProcess.
- Record Pe.Revit.Sdk defects discovered during these lanes here as follow-up notes; do not expand this work into SDK changes.

The MVP Fresh fixture proves profile storage, explicit reconciliation, fail-closed reconciliation without partial writes, source-triggered updates, and correction of a manual target override. The repository has no electrical equipment/circuit fixture, so the concrete MOCP-to-Rating relationship is implemented through the existing electrical-system collector but still needs model-backed acceptance proof before release.

## Pe.Revit.Sdk Follow-ups

- `pe-revit test fresh` default discovery does not find this repo's `Pe.Revit.Tests` project unless `--project` is supplied. The explicit run resolves it as `PeProjectKind=RevitTests`, so discovery and configured evaluation disagree.
- A `sandbox start` materialization failure reports a state-file path and recommends `sandbox status`, but no `state.json` is persisted. `status`/`restart` then return `unknown-id`; recovery is another full `sandbox start`.
- The repo pins SDK companions at beta.66, but configured restore sources do not provide that version consistently. R24 resolves `Pe.Revit.Compat.R2024` to older `dev.9`; R26 finds only versions through beta.57 and cannot reach compilation. Cross-version proof is therefore source-compatible but not package-pin-clean.

## Pe.Tools Follow-up

- `host-contracts codegen:check` targets the untargeted host at port 5180. An SDK sandbox uses its own bridge and is absent from that host's session list, so the check can silently compare against RRD or another checkout. The generator accepts `--session`, but there is no sandbox-to-host catalog target to supply. Do not treat an untargeted check as isolated proof.
- `family.editor.apply` checks `FamilyManager.Parameters.GetReferencedIn(value)` before `SetValueString`. A wattage display value such as `179 W` is therefore misclassified as a formula reference when the family has a parameter whose name matches `W`; `179` succeeds and displays as `179.00 W`. The Family Types acceptance run required this numeric retry. Fix the value-versus-formula discriminator in `RevitDataRequestService` rather than teaching route plugins unit-specific workarounds.
- A second host process cannot yet select one bridge session explicitly for Family Types calls, and host service identity is shared across local hosts. The acceptance run used an isolated feature host; multi-host development still needs a first-class session target.
- Chat attachments do not hydrate route-owned document state. The acceptance PDF had to be parsed locally and applied to the route document, while `parse_spec` also required `LLAMA_CLOUD_API_KEY` and returned an opaque failure when it was absent.
- The generic `ask_user` transcript renderer currently collapses custom questions/options into generic approval buttons. Route review should remain the human decision surface until that renderer preserves the tool's actual option contract.
- Route commands read a document, await external work, then replace the whole route document. A concurrent patch during that await can be overwritten; commands need a compare-and-swap revision or transactional document updater before routes become the default authoring surface.
- The human/agent endpoint split enforces tool-level policy, not a hostile-agent security boundary: Pea's general shell can still call localhost directly. A stronger commit capability requires a browser-held approval primitive that general agent tools cannot mint or replay.
