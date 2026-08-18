---
name: index
description: The entry point and router for this repo's skill set. Invoke with what you want to do; it picks the route and drives the loop. Use when starting any non-trivial effort, when unsure which skill fits, or when chaining phases of work.
---

# Index

The single entry point over this repo's skill set. The user states intent; you pick the route and **drive it** — chain skills automatically, stopping only at genuine decision gates (grilling answers, round verdicts, spec approval, commits). Don't recommend-and-halt.

Read [FLOWS.md](FLOWS.md) for the flow diagrams. When a route spans sessions, decide continuation per [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md). Docs conventions (ledgers, ADRs, MAP.md, grounding, handoffs) live in the `docs` skill — every route persists through it.

## Why this exists — the failure modes it prevents

- **Wrong work:** grill before building.
- **Wrong product:** prototype against real data before canonizing; the UI's demands shape the backend.
- **Lost decisions:** ledgers, ADRs, and CONTEXT.md catch what code can't say.
- **Broken code:** work through a tight red/green feedback loop.
- **Architectural decay:** test at public seams; periodically hunt deeper modules.
- **Context decay:** choose explicitly at phase boundaries instead of compacting by habit.
- **Token waste:** delegate per the `delegation` skill; the driver holds judgment, subagents hold bulk.

## Routes

Match intent to the route; enter mid-route when earlier steps are already done.

- **Find or refine a product surface (UI or the backend it demands)** → `find-the-product`. The most-traveled on-ramp. Its rounds drive `prototype` + `grilling` under `delegation`; verdicts persist per the `docs` skill (MAP.md live, LEDGER settled). When closing the chain outgrows one session, merge onto the main flow at `to-spec`.
- **An idea, settleable by conversation** → `grill-with-docs`, then: fits one session → `implement` here; multi-session → `to-spec` → `to-tickets` (Owed lines) → `implement` per ticket with `/clear` between.
- **Huge and foggy — can't see the way** → `wayfinder` (MAP.md of decision tickets). A cleared map merges at `to-spec`; it is not a build plan.
- **Something's broken** → `diagnosing-bugs`. No hypotheses before a red loop. Its "no seam exists" finding routes to `improve-codebase-architecture`.
- **Upkeep, spare cycle** → `improve-codebase-architecture`; a picked candidate re-enters at `grill-with-docs`.
- **Reading legwork** → `research` (background agent, cited file per `docs` conventions).
- **A question only a human elsewhere can answer** → `to-questionnaire`.
- **Blocked on someone/something, or design question needs runnable proof** → `prototype` directly.

Engines the routes drive (rarely invoked alone): `grilling`, `tdd`, `code-review`, `domain-modeling`, `codebase-design`, `delegation`, `docs`. Standalone utilities: `wait-what`, `handoff`, `teach`, `writing-for-agents`.

## Driving the loop

After a skill completes its phase, proceed to the next hop yourself. Stop for the human only when:

1. A decision is theirs (grilling rounds, prototype verdicts, spec/ticket approval, scope changes).
2. A destructive or outward-facing action is next (commits are fine on approved work; force-pushes, deletions of unreviewed work are not).
3. The route itself is ambiguous after reading FLOWS.md — say what you'd pick and why, then proceed unless redirected.

When a skill's SKILL.md disagrees with this index, the skill wins — this file routes, it doesn't govern.
