# Families route demiurge (opened 2026-09-23)

Trigger: the first real use of `/families` after the route rewrites. The job on 2026-09-24 is an
apply over about 7 Air Terminal families and 9 parameters. The effort shapes primitives, not the
route; `/families` is the first consumer. Cross-route verdicts land here, route evidence in
`docs/features/family/LEDGER.md`.

## Baseline (measured on `/families?demo=edit`, 1280×800)

- First data row at y=346. Ten strata sit above it: name line, sentence, verb row, band slot,
  fixture line, last-read line, rules strip, table-frame head, chip strip, column header.
- Receipts are drawn six ways: `Dialog`, verb popover flag (`SituationAction`), `OutcomeLine`,
  `WorkBand` receipt, page log, fan-out outcome.
- Narrowing has three inputs that end as the same chip: the rules text (`pivot-rules.ts`, own
  parser and hand-rolled listbox), `TableFrame` search, column facet filters.
- The families matrix is not a Reading. It is a one-shot RPC with no taken-at because a Reading
  frame is capped at `READING_MAX_FRAME_BYTES` (2 MiB) on the one host stream.

## Nouns

| Noun | Meaning |
|---|---|
| receipt | durable evidence a verb produced; outlives the verb |
| outcome | the verb's transient answer: busy, refused, ran |
| mark | a fact bound to a row or column: converged, failed, issue, stale |
| query | the one text that narrows a table; each token is a chip |
| inspectable | anything with an address a link can open |

Legacy nouns under review: band, readout, read status, rules.

## Rulings

1. 2026-09-23, receipts leave modals. Family-bound facts are marks on the table (S3). The whole
   receipt opens as an inspectable (S4). The verb flag carries only the outcome.
2. 2026-09-23, per-reading rails. A Reading's interface grows provenance (taken-at, stale mark,
   re-read verb), its slice of the page log (derived from `dirties`), and its receipts. The Pane
   draws that as one rail, collapsed to the latest line. The head keeps the sentence, the verbs,
   and log entries with no reading (target, stage, work). This absorbs `read-status.tsx`, the
   last-read line, `ChangedInRevit`'s separate button, and the read-issue and verified dialogs.
3. 2026-09-23, the matrix becomes a Reading by envelope-on-stream, body-on-RPC: the frame carries
   taken-at, changed and a version; the client fetches the body when the version moves. Raising
   the cap and paging frames were rejected. Lands in a `close` loop after this one; ADR owed then.
4. 2026-09-23, two height rungs: `--head-h` and `--item-h`. The head takes the tall one.
5. 2026-09-23, read again is not a separate button. The read verb wears the stale mark and the
   `r` chord; a failed apply's flag offers it.
6. 2026-09-23, the rule language stays as the one `TableFrame` query grammar; `ListPopup` is the
   discoverable inserter; the hand-rolled listbox in `pivot.tsx` dies.
7. 2026-09-23, a pane breaks locality too when it is far from the mark. Round 2 measured 213 px
   (pane) against 40 px to the nearest edge (mode); the top-left metric was wrong because the
   band spans the table. Superseded by ruling 9: receipts are not a pane and not page data.
8. 2026-09-23, "the current Situation head is a robust base"; paradigms inside it flip, the head
   itself is not replaced. S5 stays killed; V1's verbs-in-sentence is not adopted.
9. 2026-09-23, receipts are not their own pane and in principle never render on the page as
   data. A receipt is a log entry with a link to its inspectable (S4). Marks on family column
   headers stay a candidate, with practical doubts, not a ruling.
10. 2026-09-23, the head's log is a column, never a full-width horizontal layer. Log kinds show
   as tabs on the column (all, per reading, work, target) so a person filters there. A dense row
   shows the entry's `label`; hover shows `says` and the resource link. This replaces ruling 2's
   per-reading rail: the reading pane keeps only the stale mark on its read verb (ruling 5).
   The log title and its tabs sit on the head line above the hairline, level with the sentence.
11. 2026-09-23, the staged and proposal area of the head is a generic React slot with a default
   render. The default reads as a sentence for first-glance comprehension but is richer than
   counts, and it is not part of the targeting sentence.
12. 2026-09-23, density law for the reshape: every fact in the head earns its place by one of
   hover, colour on the text, or deletion. Most timestamps are deleted. The V1 slice is the
   data slurry to avoid.
13. 2026-09-23, one query box in `TableFrame` adopted (V5). The `narrow` inserter needs a clearer
   form; a suggestion list inside the box is the fallback.
14. 2026-09-23, the Work slot's default render says what is staged by the person and by Pea and
   on how many of each depth-1 group (families, parameters). It is computed generically from
   the Work cells with the contract's `summarize` and the route's `groupOf`, the same call
   Chat's proposal head makes, so every route gets it without prose. Primitives are the layer
   fixed; every route is a consumer.
15. 2026-09-23, an inspectable opens by its kind's default policy: the local default app for an
   artifact on disk (host shell open), or a route capable of displaying it. The registry of
   inspectable kinds carries the policy. No table mode and no pane for receipts. More displaying
   routes come as the persistence and output model of the Revit routes is honed.
16. 2026-09-23, correction to 9 and 15: a right pane for stage, apply and output IS decent on
   `/families`, because it localizes related things. Primitive first: the Situation head conveys
   the generic part of what that pane says for free (ruling 14's Work summary, ruling 10's log
   column), and the head exposes slots so a route customizes the presentation where it earns it.
   `/families` fills the pane; `/family` may summarize a geometry apply at the level of a whole
   solid extrusion instead of parameters. The slot contract is the deliverable, the pane is one
   consumer.

## Open

- Whether the artifacts link is broken live. In the demo lane `artifactDirectory` is a fake path,
  so the demo proves nothing. UNPROVEN.

## Shapes on the table

| Shape | Composition | Epitaph |
|---|---|---|
| S1 flags | every receipt is the producing verb's flag | a receipt from before reload has no verb; still an overlay |
| S2 log is the ledger | page log in a pane, rows expand to receipts | chronology is not state |
| S3 table is the page | marks on headers and gutter; head shrinks | host-level diagnostics need one unplaced slot |
| S4 addressable inspection | `?inspect=<kind>:<id>`, spec pane generalizes to an inspector, every mention links | URL state plus a registry of inspectable kinds |
| S5 no head | sentence only | scan speed dies (house law 3) |

Adopted after round 2: S4, S2 as the tabbed log column (ruling 10), S1 for outcomes only. S3 reduced to a candidate. S5 killed.

## Tomorrow slice (2026-09-24)

Plan and apply were proven small-scale by the user; a second agent is walking the verification
on 2026-09-23. No reshape from this map merges before the job.
