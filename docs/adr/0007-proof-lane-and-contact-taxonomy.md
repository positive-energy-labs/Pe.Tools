# 0007 — Proof-lane and contact taxonomy

Date: 2026-08-18. Status: superseded by [ADR 0008](0008-session-custody-and-test-rungs.md) on
2026-08-20, when Pe.Revit.Sdk beta.121 retired the `sandbox` lane, the `live` family, and the
`Rrd` tokens, and began disclosing custody itself. The taxonomy below records what this repo
decided in August 2026; it does not describe the current surface.

## Context

The repo's execution vocabulary grew in layers: "Live" as the central session paradigm, then the
literal MSBuild/SDK tokens `AttachedRrd` / `FreshRevitProcess` / `NoRrdContact` / `RrdRequired`,
then a partial retirement of standalone "RRD" in favor of "dev session". The result was three
inconsistent lane lists (`docs/BUILD.md` table missing the sandbox lane, the execution skill
running a different five, `AGENTS.md` a third), tokens that embed an acronym the glossary retired,
and evidence labels ("live-proven") that name no lane. Two parallel agent proposals were
reconciled and kaitpw approved this taxonomy on 2026-08-18.

## Decision

Every run or proof claim carries two coordinates, both spelled in plain words:

**Proof lane** — which runtime proves the claim:

| Lane | Proves | Literal token |
|---|---|---|
| `deterministic` | no-Revit tests/scorers over saved snapshots | — |
| `compile` | isolated terminal `dotnet build`; compilation only | — |
| `artifact` | build/pack output shape | — |
| `fresh` | behavior in a test-owned new Revit process | `FreshRevitProcess` |
| `sandbox` | behavior in a durable agent-owned session | — |
| `attached` | behavior in the user-owned dev session | `AttachedRrd` |
| `installed` | product-root/MSI behavior | — |

**Contact** — whose session the run touches: `none`, `owned` (agent-owned fresh/sandbox
processes), or `dev` (the user-owned dev session). Legacy binary tokens map:
`NoRrdContact` = contact none/owned, `RrdRequired` = contact dev.

Rules:

- Prose, skills, and docs use the plain words. The `Rrd`-bearing spellings survive only as
  literal code/MSBuild/SDK tokens; renaming them is SDK-owned work, Owed upstream in
  Pe.Revit.Sdk (tracked in the host ledger).
- `sandbox` is session topology as much as a lane: naming it also requires naming its evidence
  authority — source-backed or installed — per the selected runtime (ADR 0002).
- "Live" survives only as an SDK identifier (`pe-revit live`, `live_loop_context`,
  `guide live-loop`) and as product-domain data description (connected model vs authored/fixture
  state). It is never a lane, a contact, a session name, or an evidence label.
- Dated historical evidence labels in ledgers and grounding docs are not rewritten; the taxonomy
  governs new claims.
- The `execute` skill (né `execution`, renamed 2026-08-18; not `revit-loop`) is the judgment
  layer over this taxonomy: it covers every feedback lane — dotnet, host/web, browser,
  worktrees — not only Revit.

## Consequences

- `docs/BUILD.md` gains the sandbox lane and speaks plain-word lanes with the token column;
  `AGENTS.md` Proof Lanes and the execute skill restate this taxonomy, not their own.
- Evidence claims name lane + contact ("fresh-proven", "attached, contact dev") instead of
  "live-proven".
- Until the SDK renames its tokens, both spellings coexist at the code boundary; the mapping
  table above is the bridge, and this ADR is its single home.
