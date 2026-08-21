---
name: docs
description: Pe.Tools docs conventions, where every kind of durable knowledge lives. Read before writing any markdown, recording a decision, persisting research, creating a handoff, or when another skill needs a persistence home. The single source of truth all other skills defer to.
---

# Docs

Code is the spec. Markdown exists only for what code cannot say: why, what was tried and failed, and what is still owed. Before writing a doc, ask whether the knowledge belongs in code, a test, or a commit message instead, those are preferred. Exception: product/design **verdicts always go to the feature ledger**, never commit messages (the `find-the-product` rule wins).

Use ASD-STE100 Simplified Technical English and grow glossaries. Predictability and shared language allow everyone to say less and understand more. 

There is no external issue tracker. No GitHub issues, no `.scratch/`, no ticket files. Open work is an Owed item in a ledger.

## Homes, by kind of knowledge

| Home| Knowledge |
|---|---|
| `docs/features/<name>/LEDGER.md` |  Feature-scoped decisions, rejected paths, open work |
| `docs/features/<name>/MAP.md`, deleted when the effort ends |  Live-effort frontier (wayfinder tickets, find-the-product rounds) |
| `docs/adr/NNNN-slug.md` |  Decisions that constrain other features |
| Nearest package `AGENTS.md` Shared Language table; feature terms in `docs/features/<name>/GLOSSARY.md` (lazy, `domain-modeling` owns) |  Domain vocabulary |
| Hard-won wide-breadth rationale | Authority docs (registry below) |
| `.artifacts/handoffs/<date>-<topic>.md` |  Session-to-session bridges |
| relevant `docs/features/<feat>`, else `docs/research/` |  Research findings |
| Code comments at the site; a scoped grounding doc only when no code site exists |  Behavior-proven platform facts (gotchas, quirks) |
| X |  Everything else |

## Ledgers

**A feature = a canon product surface, a web-route family or a shipped ability.** Sub-efforts, per-route design sweeps, prototype rounds, and research spikes write into the OWNING cluster's ledger; they never earn a new dir. If you cannot name the shipped surface a dir serves, it is not a feature.

One `LEDGER.md` per `docs/features/<name>/` directory. Features aggregate work spanning multiple packages; the feature dir is the unit of documentation, not the package. Exactly three sections:

```markdown
# <feature> ledger

## Decided
- 2026-08-17, one-line decision, with the one-line why.

## Tried & rejected
- 2026-08-17, what was tried; why it failed. (The expensive knowledge, falsified hypotheses, losing prototypes, dead seams.)

## Owed
- open item. Delete the line when done, never mark "done".
```

Rules:
- Decided and Tried & rejected are append-only one-liners with dates. If a decision needs more than two lines of rationale, it is probably an ADR.
- An Owed item may link a spec file in the same dir if the work genuinely needs one, but default to a line.
- Deleted Owed lines are not lost, git history is the archive.
- Legacy feature dirs keep their existing files until touched; when working in one, converge: fold living content into `LEDGER.md`, delete what is stale.
- **Cross-route rule: design-language and primitive gaps are owned by `docs/features/design-system/LEDGER.md`**, one line there, consumer routes named. Route ledgers record their own application and evidence; they never restate the ruling or the gap. Same shape for any gap that spans surfaces: it lives in one ledger, and the others cite it.
- Ledgers never grow a fourth section. Reusable *method* belongs in a skill; *schema* belongs in doc-comments on the owning type (plus a showcase fixture beside the data when intent needs prose).
- **Mid-session discovered gaps** (tooling in active use finds its own hole): a code site in this repo → `TODO:` at the site, never a ledger line. No code site here (SDK defect, upstream dep) → one Owed line in the *owning* surface's ledger, never the ledger of the session that discovered it.
- When a `MAP.md` is deleted, sweep its Out-of-scope once: promote only what is expensive to re-derive or likely to be re-proposed by an agent (feature-scoped → a Tried & rejected line; cross-feature → a rejected-architecture ADR). Everything else dies with the map, code's growing mass is the real rejection.
- **Promotion and deletion happen in the same commit.** A HISTORICAL/CLOSED banner on a tracked doc is a failing state, not an archive method (`docs-guard` enforces this).
- **Merge hygiene:** fold files with `git mv` / append-then-delete so history follows. Git history is the archive only if the path chain is followable, a file that was retyped into its new home instead of moved has no chain, and the archive claim is false. When a doc line's fact belongs at a code seam, move it and delete the line; behavior-proven platform facts are the one exception and are deliberately dual-homed (see Grounding).

## ADRs

`docs/adr/NNNN-slug.md`, sequential (scan for highest number, increment). Format: Context / Decision / Consequences, one page max. Immutable once accepted; reversals are a new ADR that supersedes.

Promotion bar: write an ADR only when the decision constrains *other* features, a seam, a proof lane, a persistence model, a public contract. Feature-scoped decisions stay in the feature ledger. Rejected architecture candidates also get ADRs so future reviews don't re-suggest them.

## Authority docs

Expensive-to-derive, slowly-evolving rationale that agents repeatedly fail to intuit. Not per-feature (that's a ledger), not a single decision (that's an ADR), not operating rules (that's AGENTS.md).

Current registry:
- `docs/design/SURFACE-PHILOSOPHY.md`, what UI surfaces are for and how they behave
- `docs/features/agent/PHILOSOPHY.md`, agent design
- `docs/features/host/EFFECT-V4-PATTERNS.md`, Effect v4 idioms for the host (v3 reflexes produce wrong code)
- `docs/ARCHITECTURE.md`, `docs/BUILD.md`, `docs/OBSERVABILITY.md`, repo-wide authority

Creation bar: only after wide-breadth synthesis work that should rarely be repeated. New authority docs live where their scope lives and must be added to this registry.

## Handoffs

`.artifacts/handoffs/<yyyy-mm-dd>-<topic>.md`, for passing research, baselines, or tooling/feedback-loop issues to the next agent. Prefer a copy-pasteable inline handoff when it fits in a message; write a file only for substantive payloads.

Handoffs are disposable by construction: a handoff is *consumed* when anything worth keeping has been promoted into a ledger, ADR, or code, then delete it. `.artifacts/` is gitignored, so deleted handoffs are gone, promote first; git history never applies here. Recurring tooling issues belong in AGENTS.md, not handoffs. Never park handoffs in the OS temp dir or a `docs/` subdir.

### `.artifacts/` layout

Gitignored, so convention is the only structure. Top level holds build-tool-owned dirs (whatever `BuildArtifactLayout` writes, hands off) plus exactly four hand homes:

- `handoffs/`, as above.
- `runs/<lane>-<yyyymmdd>[-<slug>]/`, dated evidence output; deletable once its verdict is in a ledger.
- `tmp/`, nothing here may be referenced by anything; anyone may delete any of it at any time.

Worktrees are NOT an `.artifacts/` home: create them **from the command line** as siblings of the repo at the same root so every session is a peer (`~/source/repos/Pe.Tools-<slug>` for kaitpw).

A probe or spike dir carries a one-line README naming its question. If a file isn't in `handoffs/` or a dated `runs/` dir, it is not part of live work. Third-party repos cloned for research live at `./.explore/<repo>` (see the `research` skill), never in `.artifacts/`.

## Grounding

Behavior-proven facts about adversarial platforms (Revit API, Jet/RHVAC, DWG export…) are proven by real behavior, not metadata. Default home is a **code comment or test at the site the fact governs**, recurring, systemic, or big-picture gotchas especially. Write a grounding doc only when no single code site exists (e.g. a manual runbook that *is* the proof lane, an API-wide gotcha list with no wrapper to annotate), and keep it **scoped to one subject in the feature dir it serves**, never merge subjects (Revit API gotchas, Jet quirks, tooling notes) into one shared doc; that's how facts get lost.

**Proven grounding:** the second time a fact is re-derived or contested, pin it with a proof test in `Pe.Revit.Tests/Proofs/`, the `FOOTGUN:` comment names the test verbatim, the test's comment quotes the `FOOTGUN:` phrase, so one grep connects claim and proof in either direction. Don't pre-prove; the first derivation gets the comment, the second payment is the signal it's load-bearing. Grounding docs with no code site name their proof test the same way.

## Research

A single cited markdown file. Feature-scoped → the feature dir (link it from an Owed or Decided line). Repo-wide → `docs/research/`. No research branches.

## Greppable prose

Docs earn their keep by being findable from code and vice versa. Pragmatic rules:

- ASD-STE100 and unslop ALL captured knowledge, no exceptions!
- Name code identifiers **verbatim** (`FamilyModel`, `build_evidence`, `w-(--anchor-width)`), never paraphrase, abbreviate, or synonym them. One grep should connect the doc line to its code.
- In code, mark durable knowledge with a greppable prefix: `TODO:` (owed, small enough to live in code), `SHIM:` (stand-in, name the replacement condition), `FOOTGUN:` (behavior-proven platform trap). Prefer these over doc files when a code site exists; a ledger Owed line may point at a `TODO:` rather than restating it.
- Ledger/doc lines that reference a marked site quote the marker text so grep finds both ends.

## Commits

- No size rules; annotate big commits with rough shape in the subject or body: `(+85/-2098)`.
- Messages are human-readable and concrete, lead with how **behavior** changes, not abstractions ("family page reads real family.json, fixture becomes fallback" beats "refactor family data layer").

## Frozen

`docs/context/` and `docs/rework/` were swept and deleted on 2026-08-17 (every surviving fact folded into ledgers, grounding docs, ADRs, or code comments, git history holds the long forms). Neither dir may be recreated; `docs-guard.test.ts` enforces this. New writing goes to ledgers, handoffs, or (research only) `docs/research/`.
