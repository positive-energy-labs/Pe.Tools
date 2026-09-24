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
   the cap and paging frames were rejected. ADR 0013.
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

## Built (branch `families-primitives`, merged to main 2026-09-23)

- Slice 1, log column tabbed and dense; slice 2 and 2b, `WorkSentence` from the manifest's
  `cells`, `WorkBand` deleted; slice 3, `rereads` on an action and the verb wears the stale
  mark, `ChangedInRevit` and `read-status.tsx` deleted; slice 4, one query box in `TableFrame`.
- Slice 5: `route/inspect.tsx` (an inspectable is a kind with a label and an open policy),
  receipts as log rows with links, the right pane's output mode, no fake artifact path.
- Slice 5b: every log row stands alone, the meter says only the revision, the ReviewRow list
  lives in the Work slot so the grid never moves (first row y=208 in all states).
- Slice 6: ruling 3 landed. `families-matrix` envelope (415 bytes for a 1.65 MB body, host
  test), `read` declares `dirties`/`rereads: matrix`, the stale mark is the host's.
- Squashed as one commit over main; reports and screenshots under
  `.artifacts/runs/demiurge-20260923-families/`.
- 2026-09-23, the 2026-09-22 line "a read is never a verb button" is superseded by ruling 5:
  the read verb is a verb and carries the stale mark; the rail that line protected is gone.

## Rulings after the merge review (2026-09-23)

17. The log column lost its character: rows need the timestamp back and an ok/err mark; colour
   on the row is undecided. Capped at about 7 rows with expand/hide.
18. The output pane is strange. Proposals/staged, plan/apply and spec/output want one place;
   where the doc-lab (spec editor) then goes is unruled. A `protoui` question, not a slice.
19. Query chips are right; they need ellipsis truncation.
20. The proposal sentence is good enough; code is the spec.

## Rulings after the mega review (2026-09-23, eight Opus reports, `.artifacts/runs/review-20260923/SYNTHESIS.md`)

21. The log stays one canonical record per route handle, so agents and the inspector query it. The
   head draws it collapsed to the newest row with its receipt link and expands to the tabbed column
   on click. Re-openable: the user has not settled the log's final place ("the log is too busy and
   low to be immediately user facing, but i wanna keep a central log so that agents can query").
22. One query grammar. `ConditionBox` folds into `QueryBox`; `pivot-rules.ts` and the families
   `any` facet die. The step-by-step statement builder (column, operator, value) is the adopted
   UX: "the ux of building the statement part by part is really really nice". Chips live inside
   the box. A sort is a chip in the same grammar, so the sort chips return in the box, not a rail.
   Box height is the open risk; it is measured in the fold round.
23. Ctrl K is the target picker (the Ladder). The 2026-09-22 line "command palette mirrors route
   verbs" is superseded: verbs keep buttons and chords. Ctrl K opens on the first unbound rung.
24. Escape cancels a filter draft, through the list's `onEscape` door, never a hand-rolled handler.
25. A column's number-or-text kind comes from its binding, never from a guess over its values.
26. One count in one place: a value suggestion counts rows in the current scope, never the whole
   schedule; palette group heads carry no count.
27. The AddressingBar is folded: the Situation sentence names the target; drawn-read facts
   (truncated, disconnected) live in the table frame's head line.
28. The document word leaving the sentence is an experiment, kept for now.
29. `/family` and `/schedules` normalize to the same stages, verbs and wiring as `/families`:
   "families made huge strides in deleting things that shouldnt be options". Owed to the purge pass.
30. Accept/deny buttons stay on grid cells, proposals and tool approvals, in one colour language
   everywhere (closes mined V15).
31. `/param-tables` stays: its ideas feed a coming unification of param tables, data tables and
   parameter links. Only its head normalizes.
32. Content rails that browse, never switch the target (pods members, takeoff zones), stay rails.
   The Chat threads rail stays beside the Ladder palette, "good enough" for now.
33. One patch is one fragment applied the same way to every family its `select` picks
   (`FamilyPatch.cs:11-31`). The metadata diff is one row per field: the one "after" and the
   differing "befores" as counts, expandable to family names. Re-openable default.

34. 2026-09-23 night, "the three stages should be audit, apply, archive. like families!!!" Every
   entity route has the stages Auditing, Applying, Archived. Capture is not a stage.
35. "plan should be implicit prep step on apply. so u must press apply twice." There is no plan
   verb. The first apply press plans; the second press applies.
36. "schedules has the exact same verbs" as families. Push is not its own verb; it is apply.
37. "schedules and family should not get explicit read verb buttons, nor actually plan." Whether
   families keeps its `read families` button is not ruled.
38. "capture should only exist as an optional verb u can use in the audit stage to save
   persistently."
39. The Work slot on /schedules is "a mess": the proposal interface is "too scrunched to be
   reviewable"; the log's visual weight is wrong; push is drawn in the Work slot but is a verb;
   stale resolve (Overwrite N / Keep Revit's N) sits in the proposal area, "the wrong
   responsibility split". It belongs to the apply verb: an enabled verb, or buttons in the apply
   verb's action popover.
40. Rulings 34-39 supersede the stage and verb proposals the coordinator made on 2026-09-23 night
   (capture in Applying, a separate plan step). The entity-route stage and verb shape goes to a
   dedicated demiurge session: `.artifacts/handoffs/2026-09-24-entity-route-demiurge.md`.
41. 2026-09-24, entity-route demiurge round 1: "I want the ux to mostly b a schedule editor. And
   since it would then become the natural home for schedule related stuff I thought definition
   apply/capture fit well." `/schedules` stays the one home for a schedule's cells and its
   definition; no separate route, nothing moves to `/pods`. Its one `apply` verb consumes staged
   cells when any are staged (today's push), else the opened definition spec. The button names its
   object ("apply 21 cells", "apply spec <name>") and refuses when both are present.
42. "Yes to read being the only explicit." `read families` is the one explicit read verb on any
   entity route; every other Reading is automatic and the stale mark is its reread. The families
   category and family pickers stop reaching Revit on every change; they list once per document.
43. Press 1 of apply on `/families` plans one `families.plan` hop per staged family; accepted for
   now ("if the difference is big fix", it is seconds and one summed receipt). Owed: one plan call
   over every staged draft, so one press is one journal row.
44. "The picker needs to grow a callback to sort to bottom certain items ... if I'm in Chadds and 50
   mech fans r loaded but only 10 placed, the picker should reflect this. It'll make more
   performant reads the default path, and this irrelevance retaking is a good ux practice." A
   picker rung ranks by relevance: a route supplies a sink rule and the Ladder keeps the route's
   order, never re-sorting. First consumer: the families family rung sinks unplaced families under
   the placed ones and shows the placed count as the option's sub; the default read scope is the
   placed families. `placedInstanceCount` is already on the catalog entry.
45. "Yes family build is an applying verb." On `/family`, `build .rfa` sits beside `apply` on
   Applying: press 1 reviews the exact saved spec, press 2 builds it to a new .rfa. The separate
   `review build` and `cancel build` verbs are deleted; the review is build's sheet, as the plan is
   apply's.
46. "The picker scroll boxes everywhere seem not to keep selection in view when navigating with
   arrow keys." The active row of every list picker scrolls into view on arrow keys. The one list
   is `components/lang/list-popup.tsx` (Ladder, QueryBox fields, palette); it has no
   scroll-into-view today. A bug, fixed once in that file.
47. "In the search box the pickers first item should always be whatever the user has typed, this
   way when they press return it selects that one and not the first suggestion ... This would also
   be a good opportunity to display the number of items it hits so I can explore partial matches."
   In a list picker with a text box, the first row is the typed text itself, and Enter picks it;
   suggestions follow. That row shows how many items the text matches, so a partial match is a
   thing a person can pick and explore. Exact match is never silently substituted.
48. 2026-09-24, Pea surface normalization: "yes i agree with your simplest pattern basically." Every
   entity route gives Pea the same four tiers. Read: `route:<name>.view`, the mounted view (the
   families view bridge, moved into the kernel). Shape: Pea sets the query and visible columns
   without asking. Propose: proposal cells only. Mutate: apply stays human-only everywhere.
   "not very useful for family, but useful for schedules": the view is built for all three.
49. "capture into pod should be possible for all three." Capture is Pea-callable on `/family` and
   `/schedules` now. On `/families` it is deferred: "im not rly sure what this means in practice
   and it may be defered until we make some sort of table overlay that allows editing the param
   definitions. i feel like the metadata press is prob the place for this." Families capture waits
   for parameter-definition editing, likely in the parameter metadata pane.
50. "plan should always be allow[ed]." Plan changes nothing, so Pea may call it on every route
   (`families.plan` moves from human to any). "only families needs a plan": whether `/family`
   keeps its two-press apply is open.
51. The schedule catalog carries each schedule's UniqueId (or its Work key), so Pea and the
   schedule picker address a schedule's Work without a Revit read. C# catalog operation and its
   contract change.
52. "yes i say one press, bc the preview u get is functionally the same as looking at ur staged
   edits." `/family` apply is one press: it plans and applies in one run and stops if the plan
   refuses. `/families` is the only route with a two-press apply.
53. The families definition editing and families capture (ruling 49) live in the parameter
   metadata pane.
54. "yes, just the same way executing a script shows a receipt link too. i think this should be a
   general rule for route stuff maybe?" Every thing a verb produces or cites carries a link, on
   every surface: the page log, the Work slot, the plan sheet, and Pea's chat messages. A route
   verb's result says what it produced by address, never by a bare path or id.
55. "render in app if we have the infra for it. open in default app is general purpose and
   fallback. but this is a critical ui primitive too." A link opens in the app when its kind has a
   renderer (the right-pane inspector, `?inspect=<kind>:<id>`, shape S4). A kind with no renderer,
   and every file as a second action, opens in the host's default app. The link is one kit
   primitive; no surface draws a path, receipt id or reading id as text.
56. The `/families` capture verb is deleted until families capture lands in the parameter metadata
   pane (rulings 49, 53).
57. "thats what i thought it already was." Archived on `/schedules` and `/family` lists their past
   captures from the host, as `/families` lists its archived readings. An empty Archived stage is
   a bug.

## Entity route shape (ruled 2026-09-24, rulings 34-45; the baton is deleted)

One kernel, three consumers. Stages Auditing, Applying, Archived on every entity route.

| Stage | Revit | Work | Pod | Row verbs |
|---|---|---|---|---|
| Auditing | read, automatic; `read families` is the one explicit read | stage, unstage, accept, deny | `capture` files Reading plus staged as a spec (optional) | read (families only), capture |
| Applying | press 1 plans, press 2 applies, then readback | staged is the input; consumed cells retire | an opened spec is the input when nothing is staged | apply, save draft; `/family` adds build .rfa |
| Archived | none | none | none | none |

Build order (Wave B, held until now):
1. Kernel: `entityRoute` emits the three stages always, no `capture` stage, no `plan` verb, apply plans on press 1; capture is an Auditing verb on all three; `commit` and `push` die; stale resolve draws on apply's flag; a def declares `read: "explicit"` or gets none.
2. `/schedules`: apply names its object (ruling 41); `read schedule` and R die; the Ladder pick subscribes.
3. `/family`: arrival auto-capture and R die; build on Applying with its review as press 1 (ruling 45).
4. `/families`: Archived from the kernel; pickers list once and sink unplaced (ruling 44); capture declared.
5. Work slot `protoui`: V14 one-line rows with tabs; the log's weight (ruling 39).

## Owed after the entity-route wave (merged 51552a70, 2026-09-24)

Proof lane of the wave: deterministic (vp check, web unit tests, repo guards) and demo lane
(`apps/host/tests/demo-lane.scenario.test.ts`, 25/25). Nothing was seen in a real browser or a Revit
session. The unsquashed step commits are at tag `entity-route-20260924-unsquashed`.

- `/family` keeps a hidden arrival read: the `family-readings` stream only observes captures
  (`host/resource-adapters.ts`, `observeFamily`), so it cannot acquire a family by itself. The stale
  mark has no reread surface while the read verb is hidden. Owed to the host: acquire on subscribe.
- `/schedules` apply over staged cells is one press: `schedule.grid.push` has no dry run. It lost
  the push precondition `requires.work`; `staged.ready` and the host's revision base still refuse a
  stale write.
- Ruling 52 (`/family` one-press apply) and rulings 48-51 (Pea surface) are ruled, not built.
- `/families` declares a `capture` verb (`families.capture`, human only). Ruling 49 defers families
  capture to the parameter metadata pane; the verb is live until that is ruled.
- Archived is an empty stage on `/schedules` and `/family`; their past captures exist on the host.
- Ruling 43: one plan call over every staged families draft.
- Browser journeys `tests/e2e/st3-no-refresh.ts`, `st4-changed.ts` and `j6.ts` still assert push,
  `read schedule` and `plan`. Not run.
- Knip is red on main before this wave: `fieldMatches`, `MetadataControl`, three `Overlay*` types.
- Resource links (rulings 54, 55): `route/inspect.tsx` has three open policies (`route`, `shell`,
  and `href`, raw JSON in a new tab, from wave B). The in-app inspector replaces `href`.

## Normalization rules (ruling 29, 2026-09-23 night)

Each rule lands once in the primitives and every route inherits it. N1 a route with a target draws
the Situation; `AddressingBar` dies. N2 a read verb declares `rereads` by type, so it wears the
stale mark; hand-drawn refresh buttons die. N3 the log is the only home for receipts and refusals;
`OutcomeStrip`, `ActionReceipts` and log-like panes die. N4 a column facet is a query field; the
header `any` dropdown dies. N5 the Ladder is the one target picker. N6 head density: timestamps to
hover, no band repeats the Work sentence. N7 dead primitives go; knip gets production entries.

## Built after the mega review (2026-09-23 evening, commits a56b4e96..20f71870 on main)

- Chat queue and lens (a56b4e96); schedules on the primitives (dc431de3); C# UserSchedules door and
  the R24 build (3b21157d); guards green (eafa3531); schedules `cells` and PendingStrip gone
  (614d2014); families patch overlay, the table-replacing preview deleted (37ae102b); one query
  grammar merged from its worktree (20f71870). Host SURFACE scenarios updated to the folded log,
  the Ladder pick and the unpinned sentence; 25/25 green in the demo lane.
- Ruling 21 landed as the folded log; ruling 22 as `QueryBox` with fields, operators, sorts and
  `!`; rulings 24 to 27 in the same commits. Ruling 29 is still owed to the purge pass.

## Pea control shape (opened 2026-09-23, settled by rulings 48-51 on 2026-09-24)

User intent: "pea should be able to no-ask make filters for tables and stuff. and query the page
state like you can with families. and the proposal lives as route state, so they propose and query
regardless of user permission. but all the mutating verbs are not available on the public surface."
Proposed shape, unruled: a route exposes three tiers. Read: page state (target, reading, query,
Work, log) as one typed view, the families view bridge generalized. Shape: query tokens and
column visibility, no-ask, browser-local, never a Work edit. Propose: cells into Work with actor
pea; the person accepts. Mutate: read, apply, push stay off the public surface; only the person's
verb row reaches them. The tiers are the `RouteAction` record's `actor` and `needs`, not a new API.

## Families patch overlay (frontier, opened 2026-09-23)

User verdict: "proposals (and staged) overlay on the param row and also show in the minimap. metadata
needs a diff view too." The `proto-patch-review.tsx` preview that replaces the table is KILL.
Census `.artifacts/runs/review-20260923/C1-families-overlay-census.md`: the cell lane already draws
proposed (pea wash) and staged (caution square) in place; nothing projects a native FF patch into
cells. Build: pure `projectPatch(patch, rows, params)` in `families/patch-overlay.ts`, rows for
parameters the patch creates, read-only projected cells, one `ValueDiff` per metadata field, one
minimap paint pass in the pea tone. Accept and deny stay on the patch review row. Landed in
37ae102b (fixture lane only). Open: "accept all" shows for patch-only proposals but acts on cells;
a types-only parameter with no reading column gets cells but no row.

## Open
- Archived reads show their read issues nowhere after slice 3.
- A staged cell that apply retires logs as "unstaged 1 cell". Target rows say the openId, not
  the document title.
- A matrix body fetch failure is swallowed; the matrix keeps its last body.
- `/family` keeps the approximate change mark (`rereads: "work"`).

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
