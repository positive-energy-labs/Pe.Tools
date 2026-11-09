---
name: docs
description: Where every kind of durable knowledge lives in this repo. Trigger on "capture", "record this", "ledger", "ADR", "owed", "save this durably", "write it up", "where should this go", before writing any markdown, or when another skill needs a persistence home. Runbook, not a stance; the single source all other skills defer to. Formats for ADRs and glossaries live beside it.
figure: where durable knowledge lives, this repo; rebuilt like Ise, swept like a sand mandala
prevents: "lost decisions: verdicts in chat, nowhere else"
scope: repo
---

# Docs

**Docs are the Ise shrine, not the pyramid.** Ise is rebuilt identical on the next plot every twenty years and the old one comes down, so you may not add a wing to the old shrine: the knowledge survives by rebuilding, and git keeps the old timber. **And a sand mandala:** you may not keep it for the weeks it took to lay, because the sweep is part of the work.

Code is the spec. Markdown holds only what code cannot say: why, what was tried and failed, and what is still owed. Before you write a doc, ask whether the knowledge belongs in code, a test or a commit message instead, and prefer those. One exception: product and design verdicts always go to the feature ledger, never to a commit message.

Write in ASD-STE100 Simplified Technical English, without slop.

There is no external issue tracker: no GitHub issues, no `.scratch/`, no ticket files. Open work is an Owed line in a ledger.

## Homes, by kind of knowledge

| Home | Knowledge |
|---|---|
| `docs/features/<name>/LEDGER.md` | Feature-scoped decisions, rejected paths, open work |
| `docs/features/<name>/MAP.md`, deleted when the effort ends | Open decisions of a live effort (protoui rounds, muse shapes, a large change) |
| `docs/adr/NNNN-slug.md` | Decisions that constrain other features |
| Nearest package `AGENTS.md` Shared Language table; feature terms in `docs/features/<name>/GLOSSARY.md` (created when first needed; `grill` grows them; formats in `GLOSSARY-FORMAT.md` and `ADR-FORMAT.md` beside this skill) | Domain vocabulary |
| Authority docs (registry below) | Hard-won rationale of wide breadth |
| `.artifacts/handoffs/<date>-<topic>.md` | Session-to-session bridges |
| The relevant `docs/features/<feat>`, else `docs/research/` | Research findings |
| Code comments at the site; a scoped grounding doc only when no code site exists | Behavior-proven platform facts (gotchas, quirks) |
| Not written down | Everything else |

## Ledgers

A feature is a production product surface, a web-route family or a shipped ability. Sub-efforts, per-route design sweeps, prototype rounds and research spikes write into the owning feature's ledger. They never get a new directory. If you cannot name the shipped surface a directory serves, it is not a feature.

Each `docs/features/<name>/` directory has one `LEDGER.md`. A feature can span several packages, so the feature directory, not the package, is the unit of documentation. A ledger has exactly three sections:

```markdown
# <feature> ledger

## Decided
- 2026-08-17, one-line decision, with the one-line why.

## Tried & rejected
- 2026-08-17, what was tried; why it failed. (Falsified hypotheses, losing prototypes, dead seams.)

## Owed
- open item. Delete the line when done, never mark "done".
```

Rules:
- Before a sweep, keep each rationale and the locator of its evidence. Do not delete evidence a ledger needs for a promised replay. Record a retention condition, and check that a cold reader can rebuild the promised result before you delete.
- Decided and Tried & rejected lines are dated one-liners, appended in order. A decision that needs more than two lines of rationale is probably an ADR.
- An Owed line may link a spec file in the same directory when the work needs one. Default to a line.
- Delete an Owed line when it is done. Git history keeps it.
- Rebuild, don't append. When a ledger is longer than two screens, or its Decided lines predate the current shape of the code, rewrite it as the current truth in one commit and date the rewrite. Cut a Decided line that current code makes obvious. Cut a Tried & rejected line that current code makes impossible to propose again. Sweep a `MAP.md` whose open decisions have all moved, and do not amend it.
- Legacy feature directories keep their files until someone works in them. When you work in one, fold its living content into `LEDGER.md` and delete what is stale.
- Design-language and primitive gaps belong to `docs/features/design-system/LEDGER.md`, as one line that names the consumer routes. A route ledger records only its own application and evidence, and never restates the verdict or the gap. Any gap that spans surfaces works the same way: one ledger holds it, and the others cite it.
- A ledger never gets a fourth section. Reusable method belongs in a skill. Schema belongs in doc comments on the owning type, plus a showcase fixture beside the data when the intent needs prose.
- A gap found mid-session in tooling you are using goes to a code site in this repo as a `TODO:`, never as a ledger line. When no code site exists here (an SDK defect, an upstream dependency), write one Owed line in the ledger of the surface that owns it, not the ledger of the session that found it.
- When you delete a `MAP.md`, sweep its out-of-scope list once. Promote only what is expensive to rebuild or likely to be proposed again by an agent: a feature-scoped item becomes a Tried & rejected line, and a cross-feature item becomes a rejected-architecture ADR. Everything else goes with the map.
- Deleting the thing a guard checks, so that the guard turns green, is a defect. Before you remove a file a guard names, grep for text that cites it, because a prose citation without a markdown link is invisible to the guard.
- Promote and delete in the same commit. A HISTORICAL or CLOSED banner on a tracked doc is a failing state, not a way to archive.
- Fold files with `git mv`, or append and then delete, so that history follows. Git history is the archive only when the path chain can be followed, so a file retyped into its new home has no archive. When a doc line's fact belongs at a code seam, move it there and delete the line. Behavior-proven platform facts are the one exception, and they live in both places on purpose (see Grounding).

## Maps

A large change gets a `MAP.md` in its feature directory, with these headings in this order:

```markdown
# <effort> map
## Nouns and invariants
## Ordered deletable slices
## Deletion criteria
## Risk tier per surface
## Decision log
```

The decision log is append-only. The map is deleted when the effort ends, after the sweep the Ledgers rules describe.

## ADRs

`docs/adr/NNNN-slug.md`, numbered in sequence: find the highest number and add one. The format is Context, Decision, Consequences, at most one page. An accepted ADR does not change. A reversal is a new ADR that supersedes it.

Write an ADR only when the decision constrains other features: a seam, a proof lane, a persistence model or a public contract. A feature-scoped decision stays in the feature ledger. A rejected architecture candidate also gets an ADR, so that later reviews do not suggest it again.

## Authority docs

An authority doc holds rationale that is expensive to derive, changes slowly, and that agents repeatedly fail to work out. It is not per feature (that is a ledger), not one decision (that is an ADR), and not operating rules (that is `AGENTS.md`).

Current registry:
- `docs/design/SURFACE-PHILOSOPHY.md`, what UI surfaces are for and how they behave
- `docs/features/agent/PHILOSOPHY.md`, agent design
- `docs/features/host/EFFECT-V4-PATTERNS.md`, Effect v4 idioms for the host (v3 habits produce wrong code)
- `docs/features/spatial/READING-REVIT.md`, what a Revit geometry read costs and what passes as geometry but is not
- `docs/ARCHITECTURE.md`, `docs/BUILD.md`, `docs/OBSERVABILITY.md`, repo-wide authority

Write a new authority doc only after synthesis work of wide breadth that should rarely be repeated. Put it where its scope lives, and add it to this registry.

## Handoffs

`.artifacts/handoffs/<yyyy-mm-dd>-<topic>.md` passes research, baselines, or tooling and feedback-loop issues to the next agent. Prefer an inline handoff the user can copy when it fits in a message. Write a file only for a large payload.

A handoff is consumed when everything worth keeping has moved into a ledger, an ADR or code. Then delete it. `.artifacts/` is gitignored, so a deleted handoff is gone, and you promote before you delete. A recurring tooling issue belongs in `AGENTS.md`, not in a handoff. Never put a handoff in the OS temp directory or under `docs/`.

### `.artifacts/` layout

`.artifacts/` is gitignored, so convention is its only structure. The top level holds directories the build tools own (whatever `BuildArtifactLayout` writes; do not touch them), plus three hand homes:

- `handoffs/`, as above.
- `runs/<lane>-<yyyymmdd>[-<slug>]/`, dated evidence output. Keep a run while any ledger claims to replay it. Before you delete one, name and meet a retention condition: keep the source identity, method, exclusions, and enough inputs for the promised replay. Keep the decisive numbers or text in the ledger or a committed research home, because git never archives a gitignored run.
- `runs/<effort>/` also holds a `control` loop's declaration and receipts and an archivist's `RECORD.md`. Verdicts from either go to the feature ledger.
- `tmp/`. Nothing may reference anything here, and anyone may delete any of it at any time.

A skill that names its own workspace under `.artifacts/` (`page`, `debrief`, `recon`) owns that directory.

Worktrees are not an `.artifacts/` home. Create them from the command line as siblings of the repo, so that every session is a peer (`~/source/repos/Pe.Tools-<slug>`).

A probe or spike directory has a one-line README that names its question. A file outside `handoffs/`, a dated `runs/` directory or a skill workspace is not part of live work. Clone a third-party repo for research to `./.explore/<repo>`, never into `.artifacts/`.

## Grounding

Behavior-proven facts about hostile platforms (Revit API, Jet/RHVAC, DWG export and others) are proven by real behavior, not by metadata. Their default home is a code comment or test at the site the fact governs. Write a grounding doc only when no single code site exists, such as a manual runbook that is itself the proof lane, or an API-wide gotcha list with no wrapper to annotate. Keep each grounding doc to one subject, in the feature directory it serves. Never merge subjects (Revit API gotchas, Jet quirks, tooling notes) into one shared doc, because facts get lost there.

The second time a fact is derived again or disputed, pin it with a proof test in `Pe.Revit.Tests/Proofs/`. The `FOOTGUN:` comment names the test verbatim, and the test's comment quotes the `FOOTGUN:` phrase, so one grep connects claim and proof in either direction. Do not prove a fact in advance: the first derivation gets the comment, and the second derivation shows the fact matters. A grounding doc with no code site names its proof test the same way.

## Research

Research is one cited markdown file. Feature-scoped research goes in the feature directory, linked from an Owed or Decided line. Repo-wide research goes in `docs/research/`. Research never gets its own branch.

## Greppable prose

A doc is useful when code can find it and it can find code.

- Name code identifiers verbatim (`FamilyModel`, `build_evidence`, `w-(--anchor-width)`). Never paraphrase, abbreviate or substitute a synonym, so that one grep connects the doc line to its code.
- In code, mark durable knowledge with a prefix grep can find: `TODO:` (owed, small enough to live in code), `SHIM:` (a stand-in; name the condition that replaces it), `FOOTGUN:` (a behavior-proven platform trap). Prefer these to doc files when a code site exists. A ledger Owed line may point at a `TODO:` instead of restating it.
- A ledger or doc line that refers to a marked site quotes the marker text, so grep finds both ends.

## Commits

- Commits have no size rule. Note the rough shape of a large commit in its subject or body, such as `(+85/-2098)`.
- Write messages a person can read, and lead with how behavior changes. "family page reads real family.json, fixture becomes fallback" is better than "refactor family data layer".

## Deleted homes

`docs/context/` and `docs/rework/` were swept and deleted. Do not recreate either. New writing goes to ledgers, handoffs, or (research only) `docs/research/`.
