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
| 2 | Storage root | OneDrive-bound paths in `host/src/product-paths.ts` | Work and the firm file resolve under the shared mount; route settings and `productPeaWorkPath` stay on machine state (amended 2026-11-10: the only route setting is per-user consent, `chat.autoApprove`, ADR 0026 setting role) |
| 3 | Journal services | `new ActionJournal` and `new HostLog` outside a Layer (`gateway-owner.ts:29-30`) | one test provides a fake journal through a Layer |
| 4 | Run islands | the 9 `Effect.runPromise` calls in `call-route.ts` | shared read: an abort removes only that requester, and when the last requester aborts the host sends one `op.cancel` and dispatches nothing new; `RequestIdentity` is readable at native admission (`HostNativeRead.read`); durable command: after the row is journaled, aborting the `/call` admission changes nothing, `wait(id)` reaches a terminal receipt, and only `cancel(id)` sends `op.cancel` (restated 2026-11-10 from the slice 4 shape pass) |
| 5 | SubjectRef | `localId` prefixes, `ducts/pointer-refs.ts`, the fans `elementKey` regex, ElementId claims | one codec round-trips every key kind, placement and sub; stale Work discarded with no migration (ADR 0033 rule 5) |
| 5a | Registry | the four web and two host route registries, every per-route TanStack file (`routes/<key>.tsx`), every per-route contract stub (`agent-contracts/src/routes/<key>.ts`), the in-directory `context`/`host`/`neutral` generated files; `admitted-builtin-keys` derives; the codegen check that forbids a host read in the route directory | one generated registry; the builtin author's `PLACES.md` list drops to the route directory plus the C# op; the builtin specimen's directory count is 1 with its host read in it; a guard keeps browser-only code out of the host build and the reverse; the capability type is inferred from the route's host read; the icon is any Lucide name checked against the library |
| 6 | Chrome | `HistoryRail`, per-pane Refresh, the `frame` knobs (`header: false`, `refresh: false`, `scroll: "clip"`), the composer `ArmingStrip`, both Timeline-head consent branches, `Pane` and `GraphLayoutView` exports to routes, the browser join in `navigation/ledger.tsx`, the second projection in `notices.ts` | /pea measures 2 scroll tracks and the dock 1; one `ConsentSweep` on web and in the tray card; home Activity, tray Activity and Mod+Shift+K read the notice feed |
| 7 | Sheet slot | hydronic `mount.tsx`, fans' borrowed `InputsBody`, hand-written plan and apply registration, `ducts.apply.preview` as a false TransactRead (wave 2 V1) | the slot draws a binding's StateCells; a ModelWrite binds a plan whose effect is Read or TransactRead |
| 8 | Picture slot | `poseFields`, `ductsPictureFields` on fans, route-authored SceneRequests, halo and context aliases, selection-string bridges, the borrowed picture body | point, select and frame a linked fan port in two placements, and inspect an empty region, with no route translator |
| 9 | Findings | `ductClaimSchema`, rooms notes, the ducts proto inbox as a notice surface | Pea and a person each write a finding on a fan port and on a /families row; `findings.list` returns each; undo leaves the other; a `note` with a verdict is refused; one mark draws on the port's geometry |
| 10 | Non-exemplar routes onto slots | each route's hand-authored panes, readings and codecs as it moves to slots, in the order chat, pods, settings, index, ops, bind, family, rooms; duct-loss is ported to a Pod; design-system stays | the route is driven live on a controlled document (ADR 0026 D8); /family keeps the doc-lab acceptance below |

Aggregate exit, not a slice: `fans/route.ts` is about 30 lines with zero imports from web `ducts/`, and a fresh agent re-audits fans and ducts against the kernel's duties and finds nothing new.

Carried from wave 2: V3 (the host filters admitted routes out of Pea's Work tools, `host/src/app.ts:263`, `mcps/src/pea/routes.ts:24-30`) lands with slice 7; V2 (the MCP preflight reads the old `groups` scope) lands with slice 5.

### /family acceptance (kaitpw, 2026-11-05, carried)

A real PDF and real cells; no mock witness. Pea stages a cited value as a Pea StateCell inside the Reject window with a citation to a page, block or image region; Pin keeps the value and citation through review; `attach_spec` accepts a path, a URL and an upload; a saved member reopens without reparsing; the person keeps or reverts the same StateCell beside the highlighted evidence, with no separate Accept/Reject lane.

## Author witnesses (kaitpw, 2026-11-10)

Two Opus threads build one frozen product spec, hydronic pipe sizing (`.artifacts/runs/kernel-crusade-20261110/authors/SPEC-hydronic.md`), blind to the old builtin at `57721b39`: one as a Pod, one as a builtin route on slots. At every slice landing each rebuilds on the new tip and records what it still cannot express as a red `kernel gap:` test; after slices 7 and 9 each re-authors from scratch. One instrument (`authors/measure.py`) measures both: authored lines, files, directories, generated files, gap tests, `unknown` and casts. The before number at `57721b39` is 699 authored lines in 21 files across 11 directories plus 19 generated files. The driver drives both in the browser on real Revit after slices 7 and 9. The hydronic Pod lands on main as the first curated example Pod; the builtin specimen is never merged. kaitpw: "I have yet to see with my own eyes a pod route successfully binding, reading and applying a revit doc."

Pod scope added to the slices: slice 7's falsifier also requires a Pod to plan and apply a parameter write to a Revit document through the sheet slot; slice 8's falsifier also requires a Pod to fill the picture slot with scope and marks from the closed set. Both falsifiers are the Pod author's red tests.

Pod doors, kaitpw 2026-11-10: they land inside slice 7 with the goal slot, no separate 7a, from the Pod author's first gaps (`authors/pod/gaps.json`). Rung 1, generic: one catalog Read `mep.system.members` in the C# MEP library beside the duct code (`dotnet/Pe.Revit.Global/Lib/Mep`) returning any MEP system's members with flow, size, length, connections with each connector's flow direction, and the system's source, plus one segment-size catalog read; the kernel learns no MEP words. kaitpw: "id prefer generic shape obviously". Kernel: a Pod's typed catalog read door through `@pe/host/read-graph` (today `nativeRead` is private to `host/src/reads/inputs.ts`), and the firm file as a value layer a Pod read can resolve. The goal slot joins slice 7 because the sheet and the Goal draw from the same route core (ADR 0030 rule 3).

File moves and renames are greenlit for every writer when they cut a measure (fewer directories touched per route, a route's code in one place, a name that says what survives). kaitpw: "pls explicitly greenlight and encourage file moves/renames too if it helps measures." Use `git mv` so history follows.

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
- 2026-11-10, kaitpw: two author witnesses on one frozen hydronic spec, Pod and builtin; Pod Revit apply joins slice 7 and Pod picture joins slice 8; the hydronic Pod ships as the first example Pod; file moves and renames greenlit.
- 2026-11-10, implementor: slice 4's falsifier restated per owner lifetime. A shared flight must not die when one requester aborts, and a journaled command outlives its request by design; `NativeReads` already is the refcounted shared flight, so the snapshot and Ducts owners delete their own sharing code.
- 2026-11-10, implementor: Pod doors (piping reads, pipe sizes, the Pod catalog read door, the firm layer) are written in parallel and land with slice 7; the goal slot joins slice 7. Re-openable.
- 2026-11-10, implementor (slice 2 quality pass): route settings stay on machine state, because the only route setting is Pea's per-user consent switch and a shared mount would make one person's auto-approve every machine's. Re-openable.
- 2026-11-10, kaitpw: the goal slot and the Pod doors land inside slice 7; the MEP read is generic (`mep.system.members` plus a segment-size read), "id prefer generic shape obviously"; slice 5a (one generated registry, per-route stub files deleted, host read in the route directory, inferred capability type, any Lucide icon) follows SubjectRef, "agree on all especially 3."
