# 0027: One route, one subject; one consent

Date: 2026-11-02. Status: accepted. Source: kaitpw, grill rounds 1 and 2 in the route-kernel thread (c0340432), after the `/ducts` real-use drive and four reviews (`.artifacts/tmp/unification-2/`). Amends [ADR 0026](0026-one-route-shell.md). Rule 10 is amended by [ADR 0030](0030-pea-first-goal-core-plan-statecell.md): a write shows its plan, and a rehearsal in Revit is optional. Supersedes the per-turn consent of [ADR 0024](0024-root-run-consent-and-shared-work.md) and the access switch of [ADR 0021](0021-one-access-switch-and-document-targets.md).

## Context

ADR 0026 gave every route one manifest, but it named no subject. On `/ducts`, two products (system pricing and the fan sheet) shared one route through stages. The result: the system picker showed on the fan stage, `system=` stayed in the link, tab labels went stale, and the picture remounted on a stage switch. The same gaps were found in families, family and rooms. Selection had two sources (a list read the computed result, a click wrote the page). Pea met three approval gates (a per-call harness ask, a per-turn countdown, a per-command `required` review), and one research run asked more than 50 times. Wave 2 is to leave no stone unturned, so that new product routes are cheap and this layer can stay untouched.

## Decision

**Subject**
1. One route asks one question about one kind of subject. A change of subject noun is a new route, never a stage. `/ducts` (systems) and `/fans` (a fan's air path) are two routes with declared deep links that carry the subject.
2. A stage is a mode or walk over the same subject. A person can always pick it, and `pick: false` is deleted. Every route, including the PWA, reaches every stage without a URL bar.
3. The subject is declared once per route: noun, cardinality, a geometry-free roster reading for the picker, and a detail reading for what is picked. It is first-class in the list kit and the tutorial. The roster pane is the picker, its pane head shows what is picked, and the tab title shows the subject by name. The Situation sentence shrinks to document plus verbs.
4. Opening a route restores what the link or tab last had open, with the roster beside it. Nothing reads everything by default, and there is no "compute all" verb.
5. With several subjects picked, the route shows one combined picture with curated callouts and one total per subject, never a summed total.
6. A link carries the exact picked set. A `many` field encodes as a list of ids or the literal `all`. The kernel owns that codec and its meaning (every current roster member, no special logic). A guard refuses an array field not declared `many`.

**Selection and readings**
7. Selection is one thing everywhere. A list, the 3D picture, the card and an inbox row move the same selection, and the card always describes it. A plain click never moves the camera; a subject change frames it.
8. An input control shows the authored value (page or Work). The computed result and its freshness show separately.
9. Each pane head shows its own loading state and a refresh verb. Old content stays while it refreshes. No global sweep, and hiding or refocusing a tab never blanks a pane.

**Writes and consent**
10. A read never writes. Every Revit write, from a person or Pea, is derived from Work and shows a preview of exactly what it sends.
11. Commit never requires a human. Run consent lasts per thread, until Stop. Auto-approve is on by default: a "Reject?" notification times out and the command applies. The review level `required` is deleted; a command is at most `shown`. The per-call harness approval (`access.json` `guarded`) is deleted: reads, fetches and Pea's own tools never ask, and native writes outside the journal stay refused.
12. A person's undo covers Pea's Work edits too, and still refuses on "changed elsewhere". Revit model undo is not built; receipts keep clean groundwork for it (before-values).

**Engine and manifest**
13. `ducts-domain` (TS) is the one pressure-loss engine. C# only reads and writes the model.
14. The 60-line cap counts the declaration only. Bodies (verb bodies, presenters) live outside the manifest.

**Process**
15. Order: data integrity (write boundary, acceptance path), then subject and selection, then catalog scope and readings, all on one long-lived branch, landed per law with a ratchet each. A driver thread proves every route in the browser and does not stop for kaitpw's review. kaitpw's real-use drive is the final bar. Done means every route on the new declarations, every old pattern at zero, and every route proven live.

## Consequences

- AGENTS.md Posture, the ducts ledger's "Pea previews assign-fan but never applies it", and ADR 0026's "Pea may skip `shown` and never `required`" and "Pea's edits are not steps" are reversed by this ADR.
- Spike A (`t3/kernel-stage-subject`) is evidence for the subject declaration. Its "drop the other stage's subject" choice is moot after the split.
- Owed, technical shape (muse): one capability catalog versus declarations beside each endpoint; `Scope` and cost class on every `[Op]` with a codegen refusal; one reading engine; reading retention by kind; one revision-ordered acceptance path; when a review goes stale; roster, click-to-paint and memory budgets.
- Owed, product: host-filed snapshots (`?at=`); a design-system "indirectly hovered" tier; folding `DUCTS_SHEET_GUIDE` into `teach`.
