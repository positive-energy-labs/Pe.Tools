---
name: docs
description: Pe.Tools docs conventions — where every kind of durable knowledge lives. Read before writing any markdown, recording a decision, persisting research, creating a handoff, or when another skill needs a persistence home. The single source of truth all other skills defer to.
---

# Docs conventions

Code is the spec. Markdown exists only for what code cannot say: why, what was tried and failed, and what is still owed. Before writing a doc, ask whether the knowledge belongs in code, a test, or a commit message instead — those are preferred.

There is no external issue tracker. No GitHub issues, no `.scratch/`, no ticket files. Open work is an Owed item in a ledger.

## Homes, by kind of knowledge

| Knowledge | Home |
|---|---|
| Feature-scoped decisions, rejected paths, open work | `docs/features/<name>/LEDGER.md` |
| Live-effort frontier (wayfinder tickets, find-the-product rounds) | `docs/features/<name>/MAP.md` — deleted when the effort ends |
| Decisions that constrain other features | `docs/adr/NNNN-slug.md` |
| Domain vocabulary | `CONTEXT.md` at repo root (created lazily by `domain-modeling`) |
| Hard-won wide-breadth rationale | Authority docs (registry below) |
| Session-to-session bridges | `.artifacts/handoffs/<date>-<topic>.md` |
| Research findings | Feature dir if feature-scoped, else `docs/context/` |
| Live-verified platform behavior (gotchas, quirks) | Code comments at the site; a scoped grounding doc only when no code site exists |
| Everything else | Don't write it |

## Ledgers

One `LEDGER.md` per `docs/features/<name>/` directory. Features aggregate work spanning multiple packages; the feature dir is the unit of documentation, not the package. Exactly three sections:

```markdown
# <feature> ledger

## Decided
- 2026-08-17 — one-line decision, with the one-line why.

## Tried & rejected
- 2026-08-17 — what was tried; why it failed. (The expensive knowledge — falsified hypotheses, losing prototypes, dead seams.)

## Owed
- open item. Delete the line when done — never mark "done".
```

Rules:
- Decided and Tried & rejected are append-only one-liners with dates. If a decision needs more than two lines of rationale, it is probably an ADR.
- An Owed item may link a spec file in the same dir if the work genuinely needs one, but default to a line.
- Deleted Owed lines are not lost — git history is the archive.
- Legacy feature dirs keep their existing files until touched; when working in one, converge: fold living content into `LEDGER.md`, delete what is stale.

## ADRs

`docs/adr/NNNN-slug.md`, sequential (scan for highest number, increment). Format: Context / Decision / Consequences, one page max. Immutable once accepted; reversals are a new ADR that supersedes.

Promotion bar: write an ADR only when the decision constrains *other* features — a seam, a proof lane, a persistence model, a public contract. Feature-scoped decisions stay in the feature ledger. Rejected architecture candidates also get ADRs so future reviews don't re-suggest them.

## Authority docs

Expensive-to-derive, slowly-evolving rationale that agents repeatedly fail to intuit. Not per-feature (that's a ledger), not a single decision (that's an ADR), not operating rules (that's AGENTS.md).

Current registry:
- `docs/design/SURFACE-PHILOSOPHY.md` — what UI surfaces are for and how they behave
- `docs/design/DESIGN-SWEEP.md` — one-system design sweep (goal, loop, frontier)
- `docs/context/PE_DESIGN_VIBE.md` — visual design language
- `docs/features/agent/PHILOSOPHY.md` — agent design
- `docs/ARCHITECTURE.md`, `docs/BUILD.md`, `docs/OBSERVABILITY.md` — repo-wide authority

Creation bar: only after wide-breadth synthesis work that should rarely be repeated. New authority docs live where their scope lives and must be added to this registry.

## Handoffs

`.artifacts/handoffs/<yyyy-mm-dd>-<topic>.md` — for passing research, baselines, or tooling/feedback-loop issues to the next agent. Prefer a copy-pasteable inline handoff when it fits in a message; write a file only for substantive payloads.

Handoffs are disposable by construction: a handoff is *consumed* when anything worth keeping has been promoted into a ledger, ADR, or code — then delete it. Recurring tooling issues belong in AGENTS.md, not handoffs. Never park handoffs in the OS temp dir or `docs/context/`.

## Grounding

Live-verified behavior of adversarial platforms (Revit API, Jet/RHVAC, DWG export…) — facts proven by real behavior, not metadata. Default home is a **code comment or test at the site the fact governs** — recurring, systemic, or big-picture gotchas especially. Write a grounding doc only when no single code site exists (e.g. a manual runbook that *is* the proof lane, an API-wide gotcha list with no wrapper to annotate), and keep it **scoped to one subject in the feature dir it serves** — never merge subjects (Revit API gotchas, Jet quirks, tooling notes) into one shared doc; that's how facts get lost.

## Research

A single cited markdown file. Feature-scoped → the feature dir (link it from an Owed or Decided line). Repo-wide → `docs/context/`. No research branches.

## Frozen

`docs/context/` is quarantined for new session dumps — existing files stay until swept; new writing goes to ledgers, handoffs, or (research only) as above. `docs/rework/` is legacy; do not add to it.
