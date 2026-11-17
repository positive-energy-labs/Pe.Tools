# Fans and duct-systems crusade map

This map is the live frontier for the fans crusade. It is also the [ADR 0046](../../adr/0046-a-product-lives-in-one-folder.md) pilot. It replaces the 2026-10-27 path-first map, which git holds at 5209e50c. That map's verdicts are in [LEDGER.md](LEDGER.md) Decided (the 2026-10-27 to 2026-10-29 lines). Its open items are carried into the decision log below. Nothing here is built. Delete this file when the last slice lands, and promote what survives into the `duct-systems` and `fans` ledgers that slice R creates.

Evidence:

- `.artifacts/runs/mega-review-20261112/signed.md` (table 2, the signed shape);
- `.artifacts/runs/fans-ready-20261116/` (readiness review: five sealed readers, the page `page/readiness.html`, breaks B1 to B8, rulings Q1 to Q7);
- `.artifacts/runs/host-leak-20261116/` (four sealed readers on product code outside its home);
- the spike branches `spike/fans-write-from-sheet` c7d788f1 and `spike/ducts-from-sheets` 36978a1e.
- the 2026-11-03 Revit dev meetup with Hap (Manual D): `.artifacts/meetings/2026-11-03-revit-dev-meetup/REPORT.md` (action items A to E, checks C1 to C8), `CONVERGENCE.md` (the converged Manual D model M1 to M17, and kaitpw's rulings in section (i)), `corrections-explained.md`. Read these before landing 1, because they hold the engineering behind Q1 to Q4;
- `.artifacts/runs/fans-map-check-20261116/P1-reply.md` (map check 1: anchors, the import-graph file assignment for slices X and M, sizes) and `.artifacts/runs/host-leak-20261116/B-reply.md` (host-leak reader B);
- the reader threads in T3, readable with `t3_thread_read`: [host-leak A](t3-thread://v2/f14f112d-ddd1-45d1-9d3d-a1b59329e54d/thread:delegated-task:command%3Amcp%3A76929774-3fe8-4922-8f82-34837b6b1072%3Adelegate-task%3Afe8e07b4-d4b6-4b48-ac06-3704d518b8d7), [host-leak B](t3-thread://v2/f14f112d-ddd1-45d1-9d3d-a1b59329e54d/thread:delegated-task:command%3Amcp%3A76929774-3fe8-4922-8f82-34837b6b1072%3Adelegate-task%3Ab49be365-c763-40f4-9fe5-746e98f4ea19), [host-leak C](t3-thread://v2/f14f112d-ddd1-45d1-9d3d-a1b59329e54d/thread:delegated-task:command%3Amcp%3A76929774-3fe8-4922-8f82-34837b6b1072%3Adelegate-task%3A400d9387-05d2-4519-a0a3-1ade2de3745e), [host-leak D](t3-thread://v2/f14f112d-ddd1-45d1-9d3d-a1b59329e54d/thread:delegated-task:command%3Amcp%3A76929774-3fe8-4922-8f82-34837b6b1072%3Adelegate-task%3A1faab30d-5734-4612-a5f6-3f580cba51aa), [map check 1](t3-thread://v2/f14f112d-ddd1-45d1-9d3d-a1b59329e54d/thread:delegated-task:command%3Amcp%3A76929774-3fe8-4922-8f82-34837b6b1072%3Adelegate-task%3A19fad8f2-a8a2-4b48-8944-03e63e58ee66), [map check 2](t3-thread://v2/f14f112d-ddd1-45d1-9d3d-a1b59329e54d/thread:delegated-task:command%3Amcp%3A76929774-3fe8-4922-8f82-34837b6b1072%3Adelegate-task%3A1975bce8-a2c9-4f59-9012-364bba2861e2). Map check 2 holds the censuses behind D1, D2, D3 and D4.

Keep these while this map exists. Everything under `.artifacts/` is gitignored and lives only in the main checkout, so read it there from a worktree.

Stamp for the whole plan: UNPROVEN[nothing is built; each slice names the lane that proves it]. Every code `path:line` is at 5209e50c and is a locator to re-check, not a fact. Doc anchors (`LEDGER.md:N`, `../routes/LEDGER.md:N`) are at the commit that adds this map. Short paths expand from `ts/apps/` (`web/src`, `host/src`) and `ts/packages/` (`agent-contracts/src`, `mcps/src`, `ducts-domain/src`). Every size is a spike estimate or a `wc -l` count, not a measured writer rate.

The goal, in the owner's words: "it should be system and fans, both coming out of ducts. no more sheet or proto/e". D9 then named the network product `duct-systems`. Restated: `/fans` becomes the one authority for a fan's required static, and only a complete claim writes to Revit. `/ducts` becomes `duct-systems`, which keeps network health and heal and reads fan results for pressure. The group engine is deleted. Each product's TypeScript moves into one folder.

## Start here (for the agent that runs this map)

The author of this map does not run it. Read in this order: this file, ADR 0046, `LEDGER.md` Owed (the `FANS CRUSADE` lines), then map check 1's reply for the file manifests. Rulings gate waves, not the whole map:

- Every gating ruling is in: Q1 to Q7, D1, D2, D3, D9 and H5. D4 to D8 have defaults and gate nothing until late.
- Start with W0. The waves run W0, X, M, L1, L2, R.

Ask the owner for an open ruling when its wave is next, with the plain-language question in the decision log. Do not decide one on a default unless the owner is away, and then mark it re-openable, as `index` says.

## Nouns and invariants

**Products** (ADR 0046):

- `ducts` is the shared base, with no route. It holds fitting physics, loss tables, the catalog, the network graph, the leg pricer (today's `ducts-domain/src/kernel/`), the inputs both products resolve, and the presentation both pictures draw with. Map check 1 counted today's coupling by whole file: 12,104 domain lines are reached by both products, 1,016 only by system, 122 only by fans. Slice X cuts that down before anything moves.
- `duct-systems` (ruled D9) is today's `/ducts` route: network health, heal, system lists. It works with no fan.
- `fans` is today's `/fans` route: the fan roster, each fan's path pricing, the claim, and the Revit write.
- Each one is `ts/products/<product>/{domain,web,host,contract}`, with one package for each runtime.

**Invariants:**

1. A fan's required ESP is a result. Only a `complete` claim mints a write request. The claim is `complete`, `to-boundary` or `incomplete`. A branded request type makes any other source unrepresentable (spike A).
2. The write request carries no derived flow.
3. Every staged value carries who staged it and its source, from the Work cell to the write request.
4. One table authors the fans inputs: name, role, on, domain, home, owner, layers. Bindings, edit schemas, ownership and write rows derive from it. The table lives in `fans/contract`, not in `agent-contracts`.
5. An `ENCOUNTERS` rule table decides what happens where one fan's air meets another's. It has separate `verdict` and `static` columns.
6. A duct that several fans price shows each fan's loss. There is no sum and no invented owner.
7. No migration. One notice lists each value that was set aside, by row and source.
8. The group engine is deleted only in the landing where `duct-systems` reads fan results for its tree, bars and encodings.
9. Generic code names no product outside the registration allowlist (ADR 0046 guard).
10. No path or name under `ducts`, `duct-systems` or `fans` contains `sheet`, `proto`, or a single-letter variant name. The generic kernel slot `sheet` keeps its name (`LEDGER.md:132`).

## Ordered deletable slices

Each slice is one writer's branch. A slice merges when its typecheck and touched tests pass. Proof rows trail the merged tip, as `delegate` defines.

**Wave 0: kernel traps** (ruled Q6: run first)

| Slice | Change | Falsifier | Observed paths |
|---|---|---|---|
| W0-1 | One Place membership for both clients (B6, D30): Pea's history sends the Works its publications read. | Deterministic: a Pea undo on `/fans` steps a Ducts edit the fans read used. | `ts/packages/mcps/src/pea/capability-tools.ts`, `ts/apps/web/src/shell/typed-mount.ts` |
| W0-2 | Roster by mark, bounded, and a real `reads.value` input schema (B8, D45). | Deterministic: a lookup of MA-1 by mark returns one row under 4 KB. | `agent-contracts/src/ducts-sheet.ts:303`, `agent-contracts/src/value.ts`, `mcps/src/server.ts` |
| W0-3 | Delete `proposal` and `edits` from the fan read request (`agent-contracts/src/ducts-sheet.ts:283`, `:285`), and fix the guide line that says they write a join ruling (`:314`, B5). | Deterministic: the guide has no claim the code does not perform. | `ts/packages/agent-contracts/src/ducts-sheet.ts`, `ts/apps/web/src/ducts/fan-sheet.ts:134` |
| W0-4 | The cohort guard compares values over every asked unit (B4), with a fresh-rung falsifier. | `pe-revit test`, fresh rung: A=1 and B=-1 on one type, B refused, B does not move. | `dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs`, `ts/apps/host/src/ducts-actions.ts:53` |
| W0-5 | A failed native peer read reports as lost coverage, not as an open end (B3). | `pe-revit test`: a forced `Try` failure sets `truncated` and names the peer. | `dotnet/Pe.Revit.Global/Lib/Mep/DuctSnapshots.cs` |
| W0-6 | The review takes the author from the cell (D29). Cell authorship already exists (`agent-contracts/src/draft.ts:23`), so this needs no L1 work. | Deterministic: Pea's staged edit reads "staged by Pea". | `ts/apps/web/src/ducts/reviews.ts`, `ts/apps/web/src/ducts/loss-review.test.ts` |
| W0-7 | Q1's record: `sheet/flow.ts:3-4` still says a fan's flow is "never an input". Rewrite it to Q1 B (a stated flow is an input; otherwise the terminal sum is a result, never written). | Deterministic: the existing flow tests stay green; the header cites `LEDGER.md` Q1 B. | `ts/packages/ducts-domain/src/sheet/flow.ts` |

**Slice X: boundary cuts** (each a behavior-preserving refactor; they make slice M a pure move; map check 1, `.artifacts/runs/fans-map-check-20261116/P1-reply.md`)

| Slice | Change | Falsifier | Observed paths |
|---|---|---|---|
| X1 | Route discovery and closures learn the product layout before any route moves. The web registry globs declarations and closures (`web/src/route/registry.ts:11`, `:15`, `:31`). The route generator (`web/scripts/route-graphs.ts:125`) and registry renderer (`web/scripts/route-registry.ts:39`) hard-code `web/src`. Startup discovery (`host-contracts/src/route-startup.ts:74`) and the host build (`ts/apps/host/vite.config.ts:25`, `:33`) read closures from web folders. The route closure census root (`ts/tests/repo-guards/src/route-closure-census.ts:16`) extends to products, and its frozen edges are re-keyed. Add the host self-registration seam and the product guard in report-only mode. | Typecheck. Generated route files and closures are byte-identical before any move. The closure census reports the same 24 edges. | the files named in this row |
| X2 | Contract cuts. Split `agent-contracts/src/ducts-sheet.ts` into shared criteria and parameter words (to `ducts`) and the fan request and result (to `fans`). Split `ducts.ts` into shared value and calculation types and duct-systems Work. Split `ducts-read.ts` into duct-systems and fans reads. Move `DuctFlow` down to the shared contract, so `terminal-flows.ts:4` and `ducts.ts:26` stop importing fans, and `fans.ts:5` imports from the shared contract. | Typecheck. No contract file imports both duct-systems and fans. | `ts/packages/agent-contracts/src/{ducts-sheet,ducts,ducts-read,fans,fans-read}.ts` |
| X3 | Domain cuts. Split the fan engine's barrel: shared input types, resolution and `editPatches` (both route declarations import it) leave `sheet/inputs.ts`, `sheet/edits.ts` and `sheet/index.ts`. Break the `inputs:16` to `build` import. Extract the surviving group types (`losses.Row`, `HealView`) that `equivalent-length.ts:8`, `heal.ts:347`, `inbox-rows.ts:116` and `no-runs.ts:2` use, so that L2 can delete the engine. Split shared row types from system triage in `inbox-rows.ts`. Delete `kernel/apply-request.ts` and its export at `kernel/index.ts:5` (no production caller), and the dead `offeredFan` and `fansOwedBase` (`action-targets.ts:104`). | Typecheck and domain tests green at the same counts. No shared file imports a fans or duct-systems file. | `ts/packages/ducts-domain/src/` |
| X4 | Web cuts. Extract `DUCTS_LAYER_OPTIONS` from the duct-systems picture and publish `fansLink` as a contract, which breaks the fans and duct-systems web cycle (`ducts/sheet/picture.tsx:33`, `proto/e/screen.tsx:8`, `proto/e/fan-sections.tsx:4`). Name the shared presentation closure that both pictures use: `picture-content`, `scene`, `selection`, `encoding`, `colours`, `finding-layers`, `reviews`, `cell-focus`, `identity`, `proto/e/go-to.tsx`, `proto/encoding/{flow,picker,scale-legend}`, `sheet/{model,scoped-snapshot,input-history.neutral}`. Split the mixed host adapters `ducts/fan-sheet.ts` and `ducts/ducts-design.ts`. | Typecheck. No web file in the duct-systems set imports the fans set, or the reverse. | `ts/apps/web/src/ducts/`, `ts/apps/web/src/fans/` |
| X5 | Host cut. Split `ducts-actions.ts` executors into duct-systems (heal, assign fan) and fans (the write). `ducts-walk.ts` splits fan continuation from the common merge. | Typecheck and host tests green at the same counts. | `ts/apps/host/src/ducts-actions.ts`, `ts/apps/host/src/ducts-walk.ts` |

**Slice M: the move** (ADR 0046 pilot; `git mv` and import rewrites only, after X; file manifests come from map check 1's table)

| Slice | Change | Falsifier | Observed paths |
|---|---|---|---|
| M1 | Move the shared base to `ts/products/ducts/{domain,web,host,contract}`: physics, rules, catalog, kernel, network graph, the shared inputs, rulings, roster, staged values, write evidence, the shared presentation closure, and the shared host acquisition (`duct-catalogs.ts`, `ducts-files.ts`, `ducts-inputs.ts`, `ducts-readings.ts`, `ducts-body-basis.ts`). | Typecheck and the moved tests green at the same counts. | `ts/products/ducts/` and the source paths |
| M2 | Move fans to `ts/products/fans/`: the fan engine (`ducts-domain/src/sheet/{build,walk,flow,assumed-flow,heal,types,beyond,worksheet,state,tiers,accessory-writes}.ts`), `web/src/fans/`, the fans part of `web/src/ducts/sheet/`, and the fans contracts from X2. Map check 1 counted 9,990 production and 8,016 test lines in the named files. Files and types take the new noun (D1). Read ids and recording kinds do not change here (see R2). | Typecheck, moved tests green at the same counts, one `/fans` browser drive on a fixture. | `ts/products/fans/` and the source paths |
| M3 | Move duct-systems to `ts/products/duct-systems/`. `proto/e/` and `proto/b/model.ts` take plain names (no folding here). System health and heal domain, `fan-headroom.ts` (only the system bar uses it), and the duct-systems host files. The group engine and the circuits chain stay in `ts/packages/ducts-domain/` until L2. | Typecheck, moved tests green at the same counts, one `/ducts` browser drive. | `ts/products/duct-systems/` and the source paths |

**Landing 1: the table, sourced values, the claim** (signed items 1, 2, 3, 4, 6, 7, 8; rulings Q1 and Q3)

| Slice | Change | Falsifier | Observed paths |
|---|---|---|---|
| L1-1 | S1: one table in `fans/contract`. Six hand-kept files collapse into it. | Deterministic: bindings, edit schemas and write rows derive from the table, and a row added only to the table appears in all of them. | `ts/products/fans/contract/` |
| L1-2 | S2: author and a required `ref` through the four producers and the resolver (B2). | Deterministic: a closer default reaches the write row with its source. | `fans/domain`, `fans/web`, `ts/packages/runtime/src/route-workspace.ts` |
| L1-3 | S3: a typed closer (cell, row and offers, heal, or an encounter ruling). Stop parsing prose (today `web/src/ducts/sheet/closer.ts:259` and `:281`). | Deterministic: no closer string is parsed. | `fans/web` |
| L1-4 | S4: the claim union replaces the booleans. It needs W0-5. | Deterministic: a lost peer read can never yield `complete`. | `fans/domain` |
| L1-5 | S6: `ENCOUNTERS` with `verdict` and `static`, per Q3 (backflow) and H5. A roster unit that ends the walk gets an encounter row (`walk.ts:341` today). A small fan whose path ends inside another fan's positive-pressure duct raises a backflow error on the calc and on the picture (meetup REPORT C4, structural half; CONVERGENCE M13), and its required ESP adds the host duct's static at the tie-in (H5: "obvious yes"). That static is read from the host fan's calc as the cumulative loss from the host fan to the tie-in node, so the small fan is `complete` only when the host's calc is complete. A tie-in to a return (negative pressure) adds 0 and takes no credit (Hap SB-2). | Deterministic: DH-20 `13770619` on `13760945` and DH-31 `14640567` on `6530455` (REPORT C4) each raise the backflow error and carry the host static; an unruled encounter never reads `complete`. | `fans/domain`, `fans/contract` |
| L1-6 | S7 and S8: one fan and blocker vocabulary, generated from C#. One notice lists set-aside values by row and source. | Deterministic, plus a native catalog regeneration check. | `fans/contract`, `dotnet/Pe.Shared.RevitData/Ducts/` |

**Landing 2: the cutover** (rulings Q2, Q4, Q5, Q7; decision D2)

| Slice | Change | Falsifier | Observed paths |
|---|---|---|---|
| L2-1 | Typed leg evidence on the fan result. Flow, velocity, loss and equivalent length are already typed (`sheet/types.ts:25`). Coefficient, velocity-pressure basis and lookup inputs are missing, and the loss source is a text `ref` (`:31`). | Deterministic: `duct-systems` bars render from typed fields only. | `fans/domain`, `fans/contract` |
| L2-2 | Delete the circuits chain per D2: `circuits.ts`, `component-flows.ts`, `hydraulic-closure.ts`, `physical-graph.ts` (2,447 lines), `web/src/ducts/circuits.test.ts` (2,193 lines), the `circuits`, `circuit-path`, `components`, `flows` and `ports` projections of `ducts.analysis` (`agent-contracts/src/ducts-analysis.ts:26`, `host/src/ducts-analysis.ts:673-877`), the circuit reads in `assessment.ts:268` and `:330`, and the `design` field of the pricing read (`agent-contracts/src/ducts-read.ts:106`, `:192`). Retained analysis artifacts that carry `design` are set aside on read with a notice. | Typecheck. `rg "designCircuits|componentFlows|prescribedHydraulics|physicalGraph" ts` returns nothing. | the paths in this row |
| L2-3 | S5: the write request is minted from a complete claim (spike A). The surviving write derivation in `host/src/ducts-actions.ts:268-335` moves to `fans/domain` in this slice, not later. Retire `LOSSES_ROUTES` (`host/src/slots/sheet.ts:23`) and `applyRequest` (`pricing.ts:431`). | Deterministic: an equivalence check against the group request on the recorded fixture, with the accepted differences named first. Exact parity is already FALSIFIED (`LEDGER.md:195`: tap representative, free-text provenance, port versus group scope, ESP). `pe-revit test`: the write lands the required ESP and no flow. | `fans/domain`, `fans/host`, `ts/apps/host/src/slots/sheet.ts` |
| L2-4 | `duct-systems` reads fan results for tree, bars and encodings (spike B). Shared trunks follow ruling Q7. A system with no fan reads "Rule a fan to price this system". | Deterministic (spike B's three cases), then a browser drive on Chadds. | `duct-systems/web`, `duct-systems/domain` |
| L2-5 | S9 and S10: delete the group engine (`pricing.ts`, `losses.ts`, `fan-sections.ts`, `pricing-result.ts`, `pricing-view.ts`, 1,948 lines), `flow-write-slot.ts` (only `pricing.ts:4` imports it), and the `ducts-domain` package. `duct-loss-math.ts` moves to `ducts` first, because the separate `/duct-loss` route imports it (`web/src/duct-loss/host.ts:6`). The deletion is not isolated (census: map check 2, linked under Evidence): `survey.ts:17` imports `byFlow` and `groupFans` from `fan-sections.ts`; `heal.ts:347` and `inbox-rows.ts:116` use the `HealView` type from `pricing-view.ts`; `assessment.ts:9`, `action-targets.ts:14` and the host's `ducts-actions.ts` and `ducts-analysis.ts` import `pricing`; `readiness.ts` keeps a host caller (`ducts-analysis.ts:108`). Each one moves to `duct-systems/domain` or is rewritten in this slice. | Typecheck. `rg "@pe/ducts-domain"` returns nothing. | `ts/packages/ducts-domain/`, `duct-systems/domain`, `duct-systems/host` |
| L2-6 | O1, O2, Q2 and Q4. Q5: accept a join in place on `/fans`; if that is convoluted, fall back to the `duct-systems` verb with a link, and record the cut. O2: stage ESP for a whole fan-type cohort. Q2: rated ESP and required ESP become separate values with separate sources (B7: today both read `units[].esp`); a required ESP above rated is damage on the picture at the fan, like terminal damage (display to be confirmed with the owner on a drive). Q4: the family's connector direction sets a MUAS port's role, and a disagreement with the network is a warning on the picture (MUAS-1 `14577391`, REPORT E6). | Deterministic per item, plus `pe-revit test` for the cohort write. | `fans/*`, `DuctApplier.cs` |

**Slice R: leaks, guard, records** (host-leak readers A, C and D)

| Slice | Change | Falsifier | Observed paths |
|---|---|---|---|
| R1 | Remaining host meaning to domain: connector evidence (`host/src/ducts-analysis.ts:783-875`) and join continuation (`host/src/ducts-walk.ts:26-60`). Reuse `action-targets.ts:27` for the heal-target lookup. Write derivation already moved in L2-3. | Deterministic: the moved functions are tested in `domain` with no host import. | `duct-systems/host`, `fans/host`, `*/domain` |
| R2 | `DUCTS_DEFAULT_CRITERIA` and `criterion-words.neutral.ts` go to `ducts/contract`. In `setting-owners.ts`, lines 1-26 are ducts declarations and move; lines 27-41 are a generic registry that `web/src/route/slots/sheet/index.ts:2` imports, and stay generic. Wire renames for D1 land here together: the read ids (`ducts.sheet`, `fans.sheet`, `fans.worksheet`), the recording kind (`host/src/input-occurrence.ts:151`, `:255`, `native-recording.ts:226`), the engine version and group id, each with a set-aside notice. | The guard counts zero `ducts`, `fans` or `duct-systems` names in generic host files. An old recording is set aside with a notice, not decoded wrongly. | `ts/apps/host/src/`, `ts/packages/agent-contracts/src/` |
| R3 | Pea's ducts and ESP rules (`mcps/src/pea/instructions.ts:26`) and duct placement rules (`mcps/src/pea/skills.ts:376-486`) become guide text that the product supplies. Per D3, delete `ducts-guide.ts`, `ducts-cases.ts` and `ducts-compare.ts` (2,001 lines), their unmounted renderers (`web/src/ducts/{docs,docs-cases,introduction}.tsx`, `cases/draw.tsx`), their barrel export (`agent-contracts/src/api-schemas.ts:73`) and `ducts-guide.test.ts`. | Pea black-box replay of the MUAS-1 prompt: one call, one result, its blockers. | `ts/packages/mcps/`, `fans/contract` |
| R4 | The guard enforces for `ducts`, `duct-systems` and `fans`. Split `docs/features/ducts/` into `duct-systems` and `fans` ledgers. Update `docs/ARCHITECTURE.md` to the product-folder layout. Delete this map. | `python .agents/skills/check.py`, the guard, and a cold read of the new ledgers. | `docs/`, `ts/tests/repo-guards/src/` |

Order: W0 first, then X, then M, then L1, then L2, then R. X makes M a pure move; M runs before L1 so that each file moves once and the landings write in the final homes. Inside a wave, slices with disjoint paths run at the same time.

## Deletion criteria

- `ts/packages/ducts-domain/` does not exist, and nothing imports `@pe/ducts-domain`.
- No path under `ts/products/{ducts,duct-systems,fans}` contains `sheet`, `proto` or a single-letter folder.
- The write request type can be built only from a `complete` claim, and no write carries a derived flow.
- The product guard enforces with zero `ducts`, `duct-systems` or `fans` names in generic code.
- The `duct-systems` and `fans` ledgers exist, and every open line in this map has moved to one of them or to an ADR.

## Risk tier per surface

| Surface | Tier | Why |
|---|---|---|
| Revit write (`DuctApplier.cs`, the write request) | High | Wrong-document or wrong-value mutation. Proof is a `pe-revit test` fresh rung, never a deterministic test alone. |
| Native snapshot (`DuctSnapshots.cs`) | High | A false `complete` claim follows from a silent coverage loss. |
| Staged Work and provenance | High | Data loss of who staged a value. No migration is allowed, so set-aside must keep its bytes. |
| `/fans` and `/ducts` (duct-systems) screens | Medium | Browser drive per landing. |
| The move (slice M) | Medium | Mechanical, but about 45,000 lines. It must not change behavior. Proof is identical test counts. |
| Guard and lint | Low | Report-only first. |

## Decision log

Append only. Each open line names its default and the slice that waits on it.
- 2026-11-16, ruled (kaitpw): system and fans both come out of ducts. No `sheet` or `proto/e` in ducts paths (`LEDGER.md:132`).
- 2026-11-16, ruled (kaitpw): one folder per product, a `domain` package for every product, the shared base is `ducts`, and the pilot is fans (ADR 0046; `../routes/LEDGER.md:71`).
- 2026-11-16, ruled (kaitpw): the generic kernel slot `sheet` keeps its name. The rename covers only the ducts and fans paths (`LEDGER.md:132`).
- 2026-11-16, ruled (kaitpw): carry the old map's still-open decisions into this one and drop the rest.
- Q1 RULED 2026-11-16 (kaitpw: "B"): airflow is an input only where it is stated; otherwise the terminal sum is a result, never written. Supersedes the 2026-11-03 push-into-grilles direction. W0-7 fixes the stale header.
- Q2 RULED 2026-11-16 (kaitpw: "on the logic side i feel like itd b a major issue if these werent separated"): rated and required ESP are separate values. Display open; lead is damage on the picture at the fan. L2-6.
- Q3 RULED 2026-11-16 (kaitpw: "im pretty sure this is backflow which we need to handle and show errors for"): an encounter with another fan's duct is a backflow case and an error. The tie-in static is added per H5 (CONVERGENCE M5). L1-5.
- Q4 RULED 2026-11-16 (kaitpw: "the family, but this mismatch should be shown as an error/warning, probably onn the picture"). L2-6.
- Q5 RULED 2026-11-16 (kaitpw: "ideally on fans, but if this if its convoluted then it can b an occam cut and a is ok"). L2-6.
- Q6 RULED 2026-11-16 (kaitpw: "sure to small fixes first"). W0 runs first.
- Q7 RULED 2026-11-16 (kaitpw: "probably the chosen fans loss"). Under R-SHARE a shared duct carries its total flow on every fan's calc, so its loss is the same on each (spike B, `sheet-model.test.ts:111`); the chosen fan only selects which paths light up. L2-4.
- D1 RULED 2026-11-16 (kaitpw: "calc is fine"): one fan's priced result is a `calc`. M2 renames files and types; R2 renames the wire names (`ducts.sheet`, `fans.sheet`, `fans.worksheet`, the recording kind, `sheet/3`, the `sheet` group id, the fans route state ids), each with a set-aside notice. Census: map check 2.
- D2 RULED 2026-11-16 (kaitpw: "yes d2, delete"): delete the circuits chain and its five Pea projections (L2-2). It did a whole-network flow balance and a pressure at every port; the 2026-10-27 path-first ruling had already dropped it. The one readout this crusade needs, the static at a tie-in, comes from the host fan's calc (L1-5).
- D3 RULED 2026-11-16 (kaitpw: "i need some version of the tutorial back, altho the old version is mostly certainly wrong ... i want it to b derived from the targeted doc"): R3 deletes the old guide, cases, comparison and their unmounted renderers. A new tutorial, with the visual cards and examples taken from the open document, is owed after this crusade (`LEDGER.md` Owed). No production page mounts the old one today (map check 2).
- D4 OPEN, carried from the old map: the old drop list. The census (map check 2, linked under Evidence) found that none of `fan-assignment`, `unit-roles`, `topology`, `issues`, `bins`, `readiness`, `system-scope`, `system-search` or `assessment` becomes dead when the group engine goes. `fan-assignment.ts` and `DuctFanAssigner.cs` serve system repair (the `ducts.assign-fan` op, `ducts-actions.ts:350`, `:385`). Only `offeredFan` and `fansOwedBase` (`action-targets.ts:104`) have no production caller. The default is: they all go to `duct-systems/domain`, and R1 deletes `offeredFan` and `fansOwedBase`.
- D5 OPEN, carried: the Manual D equivalent-length option. ASHRAE prices a paired elbow about 25% below Manual D 8-A2. The owner parked it. No slice waits on it.
- D6 OPEN, carried: the export format for a fan's calc (the RHVAC tree layout). No slice waits on it.
- D7 OPEN, carried: the owner and values of the firm defaults table. The code reads `<firm>/Settings/ducts.json` (`host/src/ducts-files.ts:33`, `host-contracts/src/product-paths.ts:405`); `LEDGER.md:7` still says `<shared>/Firm/ducts.json`, which is stale. R2 moves the code, not the values.
- D8 OPEN, carried: the document-wide panes of today's `/ducts` screen when reads are per system (old Q9). M3 moves them unchanged, and L2-4 decides.
- D9 RULED 2026-11-16 (kaitpw: "duct-systems"): the product, folder, route id and Work key are `duct-systems`. Staged Work keyed `"ducts"` is set aside with one notice. M3.
- 2026-11-16, map check 1 (`.artifacts/runs/fans-map-check-20261116/P1-reply.md`): slice M as first written was not a pure move (FALSIFIED). Slice X now does the cuts first. M2 and M3's earlier file lists were wrong for `roster`, `rulings`, `staged`, `write-evidence`, `airflow`, `fan-assignment` (shared) and `fan-headroom` (system). Sizes confirmed: 1,948 group engine, 2,001 old guide, 2,447 circuits. The fans figure was 9,990 production and 8,016 test lines, not 13,000 and 9,000.
- 2026-11-16, regrounded on the 2026-11-03 meetup notes (`.artifacts/meetings/2026-11-03-revit-dev-meetup/`). The design-rule checks C1 (ERV fresh air off a MUAS discharge), C2 (ERV supply downstream of an AHU) and C3 (exhaust before fresh air on a return trunk) are a separate producer (CONVERGENCE M13) and are not in this map, apart from C4's structural backflow half, which Q3 puts in L1-5. They stay owed in this ledger.
- H5 RULED 2026-11-16 (kaitpw: "this seems like an obvious yes to me", asked whether a small fan tying into a supply duct has to overcome that duct's pressure): L1-5 adds the host static at a positive-pressure tie-in. Hap was not asked; the owner answered.
