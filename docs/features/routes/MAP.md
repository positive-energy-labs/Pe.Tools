# Kernel crusade map

Live frontier for [ADR 0035](../../adr/0035-route-slots-subjectref-one-notice-feed.md). Rebuilt 2026-11-10 from the wave 2 map; git holds that map. Delete this file when the last slice lands, and promote what survives into the routes ledger. Evidence: `.artifacts/runs/kernel-crusade-20261110/` (three direction rounds, two censuses), `.artifacts/runs/kernel-audit-20261104/` (lanes A to E), `.artifacts/runs/crusade-review-20261109/` (the hydronic specimen, `F-C2-SPIKE.md`, `NATIVE-REPORT.md`).

## Nouns and invariants

- **Slot**: one of five closed kinds on the route declaration (`subject`, `sheet`, `picture`, `goal`, `layout`). The kernel owns a slot's behavior end to end; a route fills it with data and, for `goal`, one host read.
- **SubjectRef**: `{ source?, keyKind, key, placement?, sub? }`, one branded codec, decoded at every door. A document mark is never identity.
- **Binding kind**: `parameter`, `store`, `local`. Closed.
- **Body**: the branded return of `draw`, `scrollBody` or `fillBody`. A pane is a Body or a split, never both.
- **Notice feed**: the host's one `notices` Reading. Push and pull read it.
- Invariants: a route body imports only the kernel's body contract; `fans/route.ts` imports nothing from web `ducts/`; two chrome layers; consent drawn in two places; types inferred, registries generated; only the kernel grows a closed set.

## Ordered deletable slices

| # | Slice | Deletes | Red falsifier |
|---|---|---|---|
| 1 | Legacy delete | the twenty `shell/mount-*` and `legacy-*` files, `shell/readings.ts`, `readings-api.ts` and its `takeoff/sources.ts` consumer, the legacy branches at `runtime/route-view-store.ts`; `typed-shell.tsx` stops importing `mount-page` and `mount-timeline` | the web app builds with zero `mount-*` imports and all 18 routes still mount (no route goes dark or is deleted; amended twice 2026-11-10) |
| 2 | Storage root | OneDrive-bound paths in `host/src/product-paths.ts` | Work, route settings and the firm file resolve under the shared mount; `productPeaWorkPath` stays on machine state |
| 3 | Journal services | `new ActionJournal` and `new HostLog` outside a Layer (`gateway-owner.ts:29-30`) | one test provides a fake journal through a Layer |
| 4 | Run islands | the 9 `Effect.runPromise` calls in `call-route.ts` | an aborted `/call` read interrupts its native call; `RequestIdentity` is readable after the session resolve |
| 5 | SubjectRef | `localId` prefixes, `ducts/pointer-refs.ts`, the fans `elementKey` regex, ElementId claims | one codec round-trips every key kind, placement and sub; stale Work discarded with no migration (ADR 0033 rule 5) |
| 6 | Chrome | `HistoryRail`, per-pane Refresh, the `frame` knobs (`header: false`, `refresh: false`, `scroll: "clip"`), the composer `ArmingStrip`, both Timeline-head consent branches, `Pane` and `GraphLayoutView` exports to routes, the browser join in `navigation/ledger.tsx`, the second projection in `notices.ts` | /pea measures 2 scroll tracks and the dock 1; one `ConsentSweep` on web and in the tray card; home Activity, tray Activity and Mod+Shift+K read the notice feed |
| 7 | Sheet slot | hydronic `mount.tsx`, fans' borrowed `InputsBody`, hand-written plan and apply registration, `ducts.apply.preview` as a false TransactRead (wave 2 V1) | the slot draws a binding's StateCells; a ModelWrite binds a plan whose effect is Read or TransactRead |
| 8 | Picture slot | `poseFields`, `ductsPictureFields` on fans, route-authored SceneRequests, halo and context aliases, selection-string bridges, the borrowed picture body | point, select and frame a linked fan port in two placements, and inspect an empty region, with no route translator |
| 9 | Findings | `ductClaimSchema`, rooms notes, the ducts proto inbox as a notice surface | Pea and a person each write a finding on a fan port and on a /families row; `findings.list` returns each; undo leaves the other; a `note` with a verdict is refused; one mark draws on the port's geometry |
| 10 | Non-exemplar routes onto slots | each route's hand-authored panes, readings and codecs as it moves to slots, in the order chat, pods, settings, index, ops, bind, family, rooms; duct-loss is ported to a Pod; design-system stays | the route is driven live on a controlled document (ADR 0026 D8); /family keeps the doc-lab acceptance below |

Aggregate exit, not a slice: `fans/route.ts` is about 30 lines with zero imports from web `ducts/`, and a fresh agent re-audits fans and ducts against the kernel's duties and finds nothing new.

Carried from wave 2: V3 (the host filters admitted routes out of Pea's Work tools, `host/src/app.ts:263`, `mcps/src/pea/routes.ts:24-30`) lands with slice 7; V2 (the MCP preflight reads the old `groups` scope) lands with slice 5.

### /family acceptance (kaitpw, 2026-11-05, carried)

A real PDF and real cells; no mock witness. Pea stages a cited value as a Pea StateCell inside the Reject window with a citation to a page, block or image region; Pin keeps the value and citation through review; `attach_spec` accepts a path, a URL and an upload; a saved member reopens without reparsing; the person keeps or reverts the same StateCell beside the highlighted evidence, with no separate Accept/Reject lane.

## Deletion criteria

- A slice lands only when its falsifier turns green at the landed SHA and every file in its Deletes column is gone.
- A ratchet per law (ADR 0026 D7): the count of old-kernel imports only decreases.
- A `mount-*` revival is a defect.
- One writer per slice. A slice that needs a kit change sends a red `kernel gap:` test to the kit owner, never a local patch.

## Risk tier per surface

| Surface | Tier | Why |
|---|---|---|
| /fans, /ducts write path (slice 7) | integrity | plan seal, apply, the Work journal |
| Storage root (slice 2) | integrity | Work and the firm file move; model copies must not sync |
| SubjectRef (slice 5) | integrity | every door decodes it; stale Work is discarded |
| Findings (slice 9) | integrity | new shared Work two people write |
| Chrome (slice 6) | presentation | measured rails, no data path |
| Legacy delete (slice 1) | presentation | two typed-shell imports re-homed; no route goes dark |

## Decision log

- 2026-11-10, kaitpw: S1 adopted, S2 rejected, S3 as method. "your set is beautifully minimal."
- 2026-11-10, kaitpw: two chrome layers only; the thread name moves into the pane head.
- 2026-11-10, kaitpw: delete the legacy mounts now; kernel-level routes are the UX exercise. Corrected the same day: "i do not want duct loss or design system deleted ... id prefer to port duct loss to a pod, but design system must stay".
- 2026-11-10, kaitpw: Space is a dev playground, as a specimen on the design-system page.
- 2026-11-10, kaitpw: storage root to a shared drive mount before cloud.
- 2026-11-10, kaitpw: Q8 to Q14 yes (dark period, dock tabs as the dock head, storage landing, one notice feed, consent in two places, the tray's job, the ducts inbox is the goal slot).
- 2026-11-10, root thread: order is legacy delete, storage root, journal services, run islands, SubjectRef, chrome, sheet, picture, findings.
- 2026-11-10, implementor exception upheld by the root thread: no route is on the legacy kernel, so nothing goes dark at slice 1; slice 10 moves the eight non-exemplar routes onto slots. Plan docs on `crusade/kernel` at 0e0e6e69.
