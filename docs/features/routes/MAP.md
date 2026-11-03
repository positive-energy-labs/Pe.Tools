# Unification wave 2: map

Live frontier for wave 2 (ADR 0027). Delete this file when the wave closes; promote what survives into the routes ledger. Evidence: `.artifacts/tmp/unification-2/` (four reviews, catalog mock, adversarial review, per-route census) and spike branches `t3/kernel-stage-subject` @ 6010929e, `t3/ducts-reload-and-pane-refresh-research` @ d483fabc, `t3/op-scope-cost-catalog-spike` @ 6dc7153d. All census claims are source reads at 395b87e6 unless stamped otherwise.

## Seven nouns (FROZEN 2026-11-02, kaitpw "agreed on all", ADR 0028; new ideas go to Owed, not into the wave)

Two first-principles critics (`.artifacts/tmp/unification-2/big-picture-1/`) found the first shape was cut along implementation seams and missed the Pod, the Timeline and the post-commit half of a write. Proposed end state: Pea and the web are two clients of one catalog.

| Noun | Contract | Absorbs |
|---|---|---|
| **Catalog entry** | op, compose, command or route. Subject axis, Touches, Effect (Read, TransactRead, SessionWrite, ModelWrite), cost x cardinality, schemas, an example response (fixture; `OpAttribute.Example`, `Op.cs:49`). One linked catalog; builtins generated at build, Pod entries arrive at runtime through the same provider, hashed. | Pea catalog, directory (a filter over entries), write boundary (`Effect = ModelWrite` needs derive + seal; `Internal` leaves refused at the bridge), fixture lane |
| **Route** | An entry whose body is a manifest. Declares one subject field (stable key kind; the codec refuses `ElementId`), stages, panes with `draws`, verbs. | Subject declaration, directory block |
| **Page** | Fields with roles subject, selection, setting, pose; kernel codecs (`many` = ids or `all`, capped for geometry x many in the codec too). One owner; URL and tab memory are projections with an explicit restore order. | Selection |
| **Work** | One journal, one revision, Pea's edits are undo steps. One typed value resolver: run input, Work, model store (`_PE_DuctLosses`), firm, engine default; returns value, units, source, version, missing/invalid. Revit owns observed facts. | Layered values, acceptance (one identity/epoch/revision gate) |
| **Reading** | A demand on an entry, retention by kind, content-hashed published values, status and refresh in pane heads. One engine. | Pane refresh, snapshot groundwork |
| **Timeline** | Append-only: invocations (one id across journal, native execution and receipt), typed outcomes (queued, running, refused, stale, cancelled, succeeded, failed, outcome-unknown, each with reason, retry/reconcile action and preserved input), open consent windows ("Reject?" with a deadline), receipts with before-values, snapshots `{address, work revision, reading hashes}`. ActionJournal is the execution owner. | Consent surface, refusal noun, review surface, snapshots, telemetry source |
| **Pod** | An author of entries and routes, admitted by one versioned registration contract (namespaced keys, schemas, module hash, migrations). A Pod route mounts exactly like a builtin. Deactivation removes availability, never receipts or Work. | Pod routes (today a bare React view, `routes/tool.$key.tsx:33-38`) |

## Shape detail (from the catalog muse)

| Noun | Contract |
|---|---|
| Capability | One linked catalog (shape B): C# `[Op]` writes Revit leaves; one widened TS table (`peRoutes`) writes host compositions and commands; the build links them. The linker is a DAG check only: `uses` names catalog keys, `derive`/`preview` are named function references whose bodies live outside. Three axes per entry: **Subject** (what it is about), **Touches** (metadata, topology, geometry), **Effect** (Read, TransactRead, SessionWrite, ModelWrite). Cost = class x cardinality; geometry x many is refused without a cap. Axis enums are owned by C# `Op.cs` and exported by typegen. |
| Write boundary | Only ModelWrite needs derive + sealed preview: input `{target, work}`; the host derives the request from Work and seals request hash, Work revision and cells, document incarnation and dependency versions; apply refuses on a changed seal without losing input. Raw model-write ops are `Internal` and refused at the bridge, so only derived commands reach them. |
| Subject | Declared once per route: noun, cardinality, geometry-free roster reading, detail reading, `show(id)`. `many` fields use the kernel codec (ids or `all`). |
| Selection | One page field; lists, picture, card, tab and Pea bind to it. Input controls show the authored value. |
| Reading | One engine (fold `readings.ts` transport and `shell/readings.ts` demand). Kinds `op` and `compose` name catalog keys and decode by generated schema (no `z.custom`). Retention per kind: keep values and signatures across hide; release workers, ports and GPU; refetch only on changed basis or refresh. Pane heads show status and refresh from `PaneDecl.draws`. |
| Acceptance | One gate keyed on identity, epoch and revision for Work acks and stream frames. |
| Directory | A `directory` block on each graph generates home, navigation, tabs, Pea's route list, `route-graphs.ts` and `PeRoutes.generated.cs`; deletes `APP_ROUTES`. |
| Pea catalog | Generated rows + live availability overlay + one named dynamic collector (packages, skills, pages, route docs, route views). |

## Reads that write and other write-boundary breaches (fix first, ADR 0027 rule 15)

| Breach | Anchor |
|---|---|
| ducts apply sends caller payload, retires different Work, even cross-document | `ts/apps/host/src/ducts-actions.ts:60-135` |
| ducts sheet "read" writes Work at the server revision | `ts/apps/host/src/ducts-sheet.ts:263-277` |
| pods inventory GET refreshes lifecycle and runs setup hooks | census `pods.md` |
| schedules read files a reading; bind publishes Work patches | `schedule-actions.ts:168,249` |
| data-tables Open query patches the draft | `data-tables/graph.ts:72` |
| 23 of 29 Mutate ops reachable by Pea as raw rows | `capabilities.ts:63-70,257-260` |
| kernel shared Work recovery injects `required` reviews | census `pods.md`, `chat.md` |
| loss server admits tables it cannot price | `DuctApplier.cs:284` vs `DuctFittingPricing.cs:17` |
| engine counts unknown flow as 0 and certifies incomplete totals | `ducts-domain/src/sheet/flow.ts:109`, `build.ts:696`, `worksheet.ts:159` |
| host still defaults consent to guarded; Pea instructions teach per-call approval | `ts/apps/host/src/harness/providers.ts:882-886`, `mcps/src/pea/instructions.ts` |
| no recovery for a committed model with an unresolved command (disconnect, retry, partial, queued while the model changed) | ADR 0024 ActionJournal; no map contract before 2026-11-02 |
| Pod routes bypass the kernel and the host door | `ts/apps/web/src/routes/tool.$key.tsx:7,33-38` |

## Routes (census in `.artifacts/tmp/unification-2/census/`)

| Route | Subject today | Wave 2 action |
|---|---|---|
| ducts | systems and fans in one route | Split: `/ducts` (systems), `/fans` (fan path). Decided. |
| open | document | Split: document open stays; session administration becomes its own route. |
| takeoff | Work identity in place of a subject | Split three: view adoption, zone audit, RHVAC file sync. |
| space | element ids | Subject becomes a region; one selection across elements and rows. |
| pods | member | Split: member authoring stays; Pod administration becomes its own route. |
| schedules | document schedule and saved definition | Split: inspect/edit/history stays; definition authoring and apply-new move to a spec route. |
| families, family | draft scope / family doc behind Work | Declare the real subject; fix two-source selection (`page.past ‖ archive[0]`, `memory.drill`). |
| rooms | view | Fold `focus`, `card`, `selected` into one selection; marks and notes become verbs. |
| chat | thread | Keep; move thread and bulk selection out of React state. |
| parameter-links, data-tables, grilles, pages-bind, captures, settings | one subject each | Keep; delete `pick:false` and `required`; add roster/detail; grilles moves edits to verbs. |
| duct-loss | hypothetical duct case | Keep as a standalone calculator; move `web/src/duct/` into it. |
| ops | admin door | Keep outside Pea route discovery; it shares the native catalog. |
| settings | machine/user configuration | Delete the "Agent approvals" switch (`machine/body.tsx:74-80`); list every registered setting. |

## Purge and fold

- Delete: `actions/receipt.tsx` + its only test (228 LOC, the only source-dead code found).
- Fold into the kernel: the two reading engines (2,024 LOC of migration scope), the four routes' `sources.ts` fetchers, hand readiness bindings (families, family, rooms, open, parameter-links), Work review band, route controls and route retention coordination (986 LOC), `DuctsProvider`.
- Move: `prototypes/` (6,985 LOC, all live) behind manifest-declared variants; `ducts/proto/e` renamed to its route; `duct/`, `rhvac/`, `product-map/`, `state/` to their sole consumers.
- Pea: delete hand rows in `capabilities.ts` (incl. the false hint at `:334`), the `z.custom` decodes (14+), the hand sheet/roster dispatch in `capability-tools.ts:813-822`.
- Every census falsified "dead prototype" claims; the LOC win is folding coordination, not deletion.

## Open questions for kaitpw

- Q27-Q32 (adversarial review): session writes exempt from Work derivation; TransactRead declared; scripts and `pod.member.compose` under consent as the escape hatch; generated Pea catalog + live availability; split `electrical-circuits`; C# owns the axis enums. Recommendations given in thread.
- Route splits above (open, takeoff, pods, schedules) and the `/space` region subject: **answered in part, 2026-11-03, kaitpw**: freeze at `u2/families-done` and archive `takeoff`, `takeoffs`, `space`, `rhvac-sync`, `zone-audit`, `schedule-specs`, `pod-admin` and `session-admin` rather than continue their cutover in this wave ([archive ruling](LEDGER.md#decided)); the remaining split details await confirmation.
- Q33-Q37 (big-picture critics 1): adopt the seven nouns; Pods as route authors in this wave; engine home (host `compose` entry, browser worker only where marked local-ok, C# pricing deleted); stable subject keys (codec refuses `ElementId`); content-hashed readings now as snapshot groundwork.

## Cutover (ADR 0027 rule 15; reviewers' order)

1. Ratchets per law before code: host calls outside the kernel, React-held selection, unscoped geometry ops, `z.custom` count, `pick:false`, `required`, reads that write, declaration LOC.
2. Fixture-lane screenshots of every route as a change detector; diff each round. The baseline is NOT the target (kaitpw: the current head "sucks bad"); a diff means "this changed", never "this is wrong".
2b. Target look: a `protoui` + `house` pass on the new primitives (roster pane-head picker, pane-head status and refresh, Timeline head with consent windows, the shrunk Situation, tab titles, the PWA stage switch), owned by the design-system ledger's kit owner. Each route adopts the result as it migrates.
3. Write boundary, acceptance and the Timeline: invocation identity through ActionJournal, typed outcomes, reconcile-before-retry, receipt-confirmed retirement, `Internal` leaves refused at the bridge, host consent default and Pea instructions, Pea edits as undo steps (adversarial deterministic tests from `.artifacts/runs/review-20261030-ducts/`).
4. Catalog export (axes in `Op.cs`, typegen), then the DAG linker, then Pea projection.
5. Subject (stable keys), selection, directory; Pod registration so Pod routes mount like builtins; route splits; one reading engine with retention and content-hashed values; the value resolver.
6. Purge and fold per the list above; ratchets to zero.
7. Driver thread proves each route in the browser; kaitpw's drive is the final bar.
Kit has one owner thread per wave; route threads add red `kernel gap:` tests, never local kit patches. Merge main daily.

## Phase 1a checkpoint (2026-11-02)

- Ducts loss, heal and fan commands now accept only a Work handle with `expectedRevision`. The host derives requests, returns an inspectable preview seal, checks the seal on apply, and keeps ActionJournal retirement conditional on captured cells and native receipts. Domain refusals retain the existing journal wire state `failed`, with `notDispatched` and `refusal`; the new Timeline outcome enum remains a later cutover.
- Sheet reads no longer apply edits or proposals. Data Tables Open is an explicit Work verb. Schedule binding is an explicit ActionJournal command. Pod inventory reads no longer reconcile setup/cleanup; explicit import and activation do.
- Read-write census survivors: `readSchedule` files immutable evidence through `captures.saveSchedule`; this is observational retention, not authored Work or model mutation. `families/graph.ts` still adopts read results through queryVerb patches; split explicit adoption from the read in the next slice. The census excludes schedule publication inside the explicit command and plugin refresh after the GET return.
- Owed: migrate the remaining family, schedule, data-table and takeoff ModelWrite contracts to Work-only inputs and preview seals; replace legacy caller-payload forwarding tests. Connect the ducts UI's chosen heal/fan/system scope to the new `stage-write` Work verb before preview; Pea can stage `writeIntent` through the shared Work door. Browser and Revit behavior remain unproven.
