# Ducts: live frontier (muse, 2026-10-27, revised after critique)

Sweeps the 2026-10-04 map. Revised the same day after three critics (engineering truth from the
RHVAC files and MUAS-01 .r10; project history from the ledger and user turns; Astra on
architecture, method and proof; the full report is `.artifacts/runs/deterministic-20261027-ducts-history/critique-astra.md`)
and a consult with the Pe.Revit.Space thread. Each changed line names its source in brackets.
Deleted when the path engine, the roster and the sheet are the shipped route. Rulings go to
`LEDGER.md` Decided; this file holds the pillars, the priors being dropped, the target
architecture, and the verdicts still owed.

## Why

The product is a static pressure calculator for Manual D work at residential scale, where one
project (Chadds Ford) holds 360-plus systems and networks with ten-plus terminals threaded
through dehumidifiers, ERVs, heaters, silencers and dampers. Wrightsoft computes the number
fine; it cannot find the critical path on a network an engineer has not typed in by hand, and
nobody will type 360 of them. Pe reads the network from Revit and does the typing.

This was the stated goal on 2026-10-15 ("until pea can do a pdrop calc for each equipment and
grill/room") and was lost on 2026-10-20 when the Fix/Set/Check/Write inbox became the control;
the ledger records the consequence, "on Project A a Fix row always stood" [history].

The prior shape lost that goal. The 2026-10-27 Pea thread on Chadds Ford ("what do we need to
do to calc pdrop from MUAS-1 to FC-23") took 112 tool calls, 61 regex windows over a 14.5 MB
document-wide snapshot and a 77 MB analysis artifact, and returned zero pressure numbers. The
tutorial has 60 cases, 9 of them about pricing a run of duct and 28 about joins, grouping and
fan election. `ducts-domain` is 9,940 lines, 908 of them physics.

## Pillars

1. **The path is the primitive.** A path is an ordered chain of connectors, with a side
   (supply or return) and a flow direction the caller asserts. Every number the product shows
   is a sum along a path. No number belongs to a group, a Revit system, or a document.
2. **The fan sheet is the product.** Name a fan port; the engine walks outward from the
   discharge and inward from the inlet, enumerates every end it reaches, prices every path,
   ranks them per side, and reports worst supply plus worst return as that fan's required
   external static [eng 1, Astra 8]. One sheet per fan, one roster per project, one click
   recomputes all. The Manual D friction-rate worksheet, generated.
3. **A sheet always exists; a certified number does not.** Every sheet carries a known
   subtotal, an assumed estimate (defaults and cushion-type gaps), and a completeness state.
   An open end, inferred join or unknown drop is a blocker line with its effect. Two gaps
   block the total, as ruled on 2026-10-21 and 2026-10-22: no flow on a path, and an
   implausible fitting loss. An incomplete total is never ranked as the critical path and
   never written as required ESP [history 4, Astra 4].
4. **Defaults with provenance close the last mile.** Firm defaults for equipment drops,
   fitting rules and friction rate price everything nobody has ruled on. Every input on the
   sheet names its source: typed, parameter, firm default (with version), inferred. One click
   is honest when every assumption is on the page. The airflow slot is one confirmed choice
   per project, never a per-terminal fallback [history 6].
5. **Equipment is a leg, not a cut.** A dehumidifier, ERV core, heater, silencer or filter in
   the path carries a drop and passes flow. The walk passes through non-roster equipment only;
   an open equipment port is an open-end blocker [history 14]. The walk ends at a terminal,
   an open end, or another roster fan's port.
6. **One engine, one truth read, one picture read, one contract.** TypeScript prices; C#
   collects raw truth through the snapshot op; the picture is a separate Space read keyed by
   the sheet's element ids, never folded into the snapshot [Space]. The sheet is the contract
   the page, Pea and the network surface all read. The native loss server is the one named
   exception, see Write below [Astra 18].
7. **Revit metadata is a hint, direction is asserted.** System classification, connector
   direction and system names never choose a start, an end, or a fan. The caller asserts
   direction at the start; after a tap or at an air-classification change the walk honours
   the asserted flow and raises a `class-change` blocker if it would cross air types
   [eng 5, history 7]. The Greenheck intake read as a supply grille proved the first half.

## Priors to drop, and why

| Prior | Why it goes |
|---|---|
| Group, root, `g<min>` ids, loop and multi-root issues (`DuctNetwork.Analyze`, `topology.ts`, `readiness.ts`, `issues.ts`, `bins.ts`) | Existed to decide what to price before anyone named a start. A named fan port and a walk make them unnecessary. |
| Fan election and roles (`unit-roles.ts`, `fan-assignment.ts`, `DuctFanAssigner.cs`, `roles` Work segment, `ducts.assign-fan` op) | Replaced by a roster the engineer confirms once per project. On 2026-10-21 kaitpw leaned to leave system split and assign-fan "to revit and/or adhoc pea work" [history 11]. |
| Fan flow as a parameter input | Not what the engineer does: the MUAS-01 file has fan CFM zero and trunk flow as the sum of typed runouts, and kaitpw agreed on 2026-10-21 that "a fan's flow is the sum of its grilles by definition" (ledger line 62). The first draft of this map got it backwards [eng 4, history 1, Astra 3]. |
| Circuits and hydraulic closure (`circuits.ts`, `component-flows.ts`, `hydraulic-closure.ts`, `physical-graph.ts`, `calculation` Work segment, the `circuits` projections) | A second engine reachable only by Pea, never on the page, 2,184 lines plus 2,164 of tests. Nobody asked for it. |
| Revit system name as the unit (`system-scope.ts`, `system-search.ts`, the four-system window, "Name the system" step) | A system name spans networks and a network spans names. System name survives only as a search handle. |
| Document-wide analyze and the 77 MB analysis artifact (`assessment.ts`, `ducts-analysis.ts`, `assessDucts`) | Whole-document work to answer a one-path question. Pea's four-minute loss was this artifact and the geometry-script ban, not election [history 11]. |
| `ducts.ports`, `ducts.family-patch`, catalogs, loads split, `/duct-loss` math | No page caller, unscoped, or rejected in the ledger and still wired. |
| The inbox as a workflow (Fix, Set, Check, Write stages) | Topology became the product. Blockers are lines on the sheet; the two heal buttons sit beside their line. |
| Tutorial cases 12, 13, 25, 29 through 35, 51, 52 | Grouping and election cases with no subject after the pivot. |

Kept unchanged: `loss-physics.ts`, `loss-grid.ts`, `loss-rules.ts`, `catalog.ts`,
`geometry.ts`, `faces.ts`, `AshraeTables.cs`, `DuctHealer.cs`. Kept with a stated change:
`equivalent-length.ts` already converts at each leg's own rate, which is the RHVAC convention
this map now adopts; its straight-duct-at-physical-length rule stays [Astra 10].
`DuctFittingPricing.cs` goes with the loss server's recompute branch (transport ruling below). Lifted before their shells go: the tap leg split
and fitting facts in `losses.ts`, `applyRequest` in `pricing.ts`, inferred-joint geometry and
connector-pair verdicts in `proximity.ts`, the per-terminal flow order in `terminal-flows.ts`.

Rulings taken 2026-10-27 (kaitpw): ASHRAE grids stay the fitting default; the snapshot op
gains selectors rather than a second read op; Write sends required ESP and design flow to the
unit; the roster lives in the model store (reverting the earlier same-day lean to a unit
parameter, see Roster above). 2026-10-27 verdicts on the critique: terminal drops take a firm
default by family, size and cfm, one rolled-up line per sheet (reverses the 2026-10-20 leads'
zero, kaitpw); a path stops at the other roster fan's port and credits nothing from it; the
halo stays a layer and will travel with the 3D primitive when it generalises to pipes and
rooms; Manual D equivalent-length tables become a firm option beside ASHRAE grids; the loss
server transports the sheet's critical-leg coefficient into `Pe_C` rather than recomputing.

## Target architecture

### Data model

```
Roster        one per project; every (unit, port) the engineer confirmed drives air
  FanPort     unit id, port index, firm tag (PE_G___TagInstance), side served
              an ERV yields two entries (supply fan, exhaust fan)        [history 7, Astra 2]
              seeded by: Revit base equipment, then a person's ruling, then a kind heuristic
              (fan coil, AHU, ERV, MUAS by family), never by parameter presence [history 1]
              lives in the model store (_PE_DuctLosses), not a unit parameter: no slot
              binding, type-bound or linked-unit failure modes; a schedulable mirror
              parameter may be derived later (kaitpw 2026-10-27, counsel's pick) [Astra 5]

Sheet         one per fan port, recomputed on every read, never persisted as a result
  basis       document lifetime + native observation + store revision + defaults version
              + engine version; every detail, preview and write binds to it   [Astra 12]
  fan         FanPort; rated ESP (from its own slot, never the written one)   [Astra 9]
  legs{}      keyed once by element id + traversed port pair; flow cfm (+source), velocity,
              loss in-wg (+rule or drop +source), equivalent ft at this leg's own rate
              (duct and fitting legs only; typed drops stay in-wg)            [eng 2, 10]
  paths[]     per side: ordered leg-id lists from the fan port to an end;
              end kind: terminal | open-end | roster-fan-port | joins-other-fan-network
              { fanId, atElementId }                                          [eng 5, history 8]
  allowance   per side: { in-wg, note, source } a typed judgment number, its own line
              (MUAS-01's 0.15 in-wg lump was 78% of the engineer's total)     [eng 3]
  totals      per side: known subtotal, assumed estimate, completeness;
              required ESP = worst supply + worst return, only when both are complete;
              TEL and friction rate (ASP x 100 / TEL) shown as outputs        [eng 1, 2]
  blockers[]  kind: open-end | inferred-join | unknown-drop | no-flow | flow-mismatch |
              shared-leg { owner fan } | class-change | not-priced | implausible-loss;
              exact element id + connector index; effect on total; closer
              (default | heal candidate with preview handle | ruling)         [Astra 13]
  inputs      every default and override the sheet used, each with its source and version

Flow on a path                                                                [history 2, Astra 3]
  terminal    the confirmed airflow slot; missing value = no-flow blocker whose closer
              proposes the better-covered slot with its coverage
  leg         on fan F's sheet: F's share = sum of terminals F reaches through this leg;
              a side-stream unit's own flow when F is that unit; a leg carrying more of
              another roster fan's flow than F's is a shared-leg blocker naming the owner
  junction    branch, upstream-main and downstream-main flows from the same shares
              (loss-rules.ts already asks for all three)
  fan         displayed as the sum of its reached terminals; never an input

Defaults      firm scope, one versioned file in firm config; pinned by hash on each sheet
  drops       equipment drop by family and size, keyed by cfm or a curve, falling back to a
              typed per-instance number; a constant only as a stamped placeholder   [eng 7]
  rules       fitting family and type -> ASHRAE table (today's loss-rules + ruleAssignments)
  airflow     which parameter holds terminal flow (the confirmed slot)
  friction    sizing target only (RHVAC's 0.08); never a conversion rate
  roughness   flex and sheet-metal

Store         the model's _PE_DuctLosses store, travels with the .rvt       [history 3, Astra 6, 7]
  rulings     connector-pair accept/reject for inferred joins (stable identity + geometry
              freshness), open-end verdicts, slot choice, path overrides (asserted end),
              project overrides of firm defaults, the defaults version each ruling saw
Work          pending deltas only, per machine, per document (today's rule, kept)
  keep        rules, ruleAssignments, terminalDrops, componentDrops, flows, parameters,
              labelParameter, workingPhase, claims, systemColours
  add         roster suggestions awaiting confirmation
  delete      calculation, roles, loads, subject-by-group, catalogs, esp, equipmentFlows,
              designFriction-as-conversion
```

### Where the data comes from

| Datum | Source | Read |
|---|---|---|
| Elements, connectors, geometry, sizes, lengths, params | Revit, raw | `ducts.snapshot` with a selector: `from` (walk from a fan port through non-roster equipment; at every open end, count ids in a small box around the connector, MEP categories only, and include them so a join can be inferred [Space, Astra 1]), `ids`, `document` (paged, for the network surface). Output never carries groups, roots or issues. Exclusions written down: centreline helpers in the Model category, separate insulation elements (use the host's insulation thickness parameter instead), view-specific imports, unloaded links [Space]. |
| Roster | Revit base equipment, store rulings, kind heuristic; confirmation written to the model store | Same snapshot |
| Rated ESP | The unit's rating slot | Snapshot |
| Terminal flow | The confirmed slot | Snapshot |
| Equipment and terminal drop | Typed in Work, else unit parameter, else firm default by family, size and cfm | Work + snapshot + defaults |
| Fitting coefficient | ASHRAE grid via rule; `Pe_C` if the family carries one | `ducts.tables` + snapshot |
| Inferred joins | Proximity geometry on the walked elements plus the open-end candidates, filtered by connector-pair rulings | Computed in TS per walk |
| Picture geometry | Space scene read keyed by the sheet's element ids; focus-only is about 1 s and 10 MiB on Chadds, boxes context 6 to 20 s cold, meshes opt-in [Space, measured on probe-25] | Separate read, cached by document version |

### Where it writes, and where you see it

| Sink | What | Gate |
|---|---|---|
| Unit parameters | required ESP to a *required* slot distinct from the rating slot [Astra 9], design flow; failed-write and missing-slot states defined | Write review, old to new, host consent as today; only a complete total may be written |
| Model store | roster, rulings, slot choice, overrides, defaults version | Same write |
| Fitting `Pe_C` via `PeLossServer` | the named exception to one engine: the server transports the sheet's critical-leg coefficient from `Pe_C`; its C# recompute branch (`PeLossServer.cs:112`) is deleted with `DuctFittingPricing.cs`; a tap's second leg is noted on the sheet as not carried by Revit's report [Astra 18] | Same write; proof owed (ledger) |
| `/ducts` page | Roster table (one row per fan port: required ESP or completeness state, TEL, blocker count, basis freshness), sorted by blockers; open a row for the sheet; 3D draws the open sheet's worst path and blocker marks as one more layer, existing layers and colours stay as ruled 2026-10-24; calc-derived encodings (size, flow, health, legs, provenance) become sheet columns [history 10, Space] | |
| Pea | `route:ducts.sheet` in two discriminated modes: fan-port (whole sheet) or start+end with asserted direction (one chain, no ESP claim) [Astra 14]; the response is a bounded overview (ranked paths, totals, blockers, basis) with detail handles for legs, provenance and the walked element set [Astra 11]; `route:ducts.roster`; the same heal and write verbs with basis-bound candidates. Instructions: name a start, read blockers back, propose a default or a previewed heal with its effect on the total. Never grep, never elect, never compute. | Skill rendered from the same guide object as the tutorial |
| Network surface (kept, re-keyed) | Reads sheets and the `document` selector; colours by sheet, never by group | Behind the compile wall until re-keyed |
| Export | The sheet as the firm's static calc sheet (RHVAC tree layout: sections with grouped fitting counts, cumulative loss, available SP) [eng 10] | Owed |

### Order of work

0. **Falsifying spike, read-only, before any deletion** [Astra 15]: on a retained raw Chadds
   snapshot, walk from MUAS-1's discharge and inlet with connectors only, then again with the
   open-end candidate box; pin the expected chain (louver, heater, silencer, MUAS-1, FA 12
   takeoff, RA 37, FR-1, FC-23) against the red-route image and element ids; record missing
   continuations, cross-airstream candidates and truncation. Price the chain with explicit
   flows and drops; check an independent section sum. If the candidate box cannot recover the
   louver inside the plenum, pillar 6's "one raw read" is falsified and the walk needs Space.
1. Lift the kernels (tap split, fitting facts, applyRequest, joint geometry, connector-pair
   verdicts, flow order) into files with no network import. Compile proof.
2. `ducts.snapshot` `from` selector in C# with the open-end candidate box and the exclusion
   list; raw output. Fresh proof on Chadds: the spike's chain in a bounded time, with its
   inferred-join blockers named. Delete `Analyze`, groups, roots, issues and
   `DuctFanAssigner` only after step 0's membership check passes on the new read.
3. `path.ts`: walk per side, enumerate ends, flow shares, price, rank, completeness,
   blockers. Deterministic proof on the saved walk. Acceptance: section-by-section
   reconciliation against the MUAS-01 .r10 (eight sections, 0.193 total of which 0.15 is the
   typed allowance), with duct friction matched per section, a bounded fitting delta with the
   method named (Manual D codes there, ASHRAE grids here), the return side present, and the
   allowance excluded from the comparison [eng 8, history 13, Astra 16].
4. Roster: seeding order, (unit, port) identity, confirmation write, failed-write state.
   Fresh proof: census of Chadds units by kind, 71 ERVs yielding 142 ports.
5. Sheet contract with basis token, overview plus detail handles; `route:ducts.sheet` in both
   modes; Pea skill rewritten from the guide object; the black-box MUAS-1 prompt replayed as
   the acceptance test (one call, a sheet, its blockers, no number claimed as ESP).
6. Batch: recompute all roster fan ports on one document read with a shared acquisition;
   budget time and memory; prove cold batch plus one changed-fan refresh [Astra 17].
7. Roster table and sheet on `/ducts` (protoui round against the current E screen); network
   surface re-keyed from compile errors; tutorial rebuilt from the surviving cases.

## Verdicts taken 2026-10-27 (kaitpw, on the critique)

- Terminal drop default: firm default by family, size and cfm; one rolled-up line per sheet.
- Roster residency: model store (counsel's pick, kaitpw deferred).
- Fan-stop: the path ends at the other roster fan's port; nothing credited from it.
- Halo: stays a layer; travels with the 3D primitive when it generalises.
- Manual D equivalent-length tables: a firm option beside ASHRAE grids.
- Loss server: transport, not recompute.

Open on this map: where Defaults live in firm config (Pod vs repo config); the sheet's export
format; the Cleremont context numbers from the Space thread, still being measured.

## Overnight questions and assumptions (orchestrator, 2026-10-27 night; for kaitpw's morning)

Assumptions taken without a ruling; each is reversible. Questions need a verdict.

**Assumptions**
- A1 Terminal drop placeholder 0.03 in-wg for every terminal with no typed or catalog drop, marked `SHIM(ducts-terminal-drop)` / `SHIM_TERMINAL_DROP_IN_WG` (kaitpw: "louding comment it as a shim").
- A2 Side-stream (ERV/MUAS) flow = the unit's design-flow parameter; split across the roster fan ports it reaches by `splitPolicy` even (default) or proportional to the receiving fans' design flow; a typed end cfm wins (kaitpw: "the most flexible").
- A3 Revit's own terminal Flow is a confirmable project airflow slot (`revit:Flow`). On Chadds it covers 355 of 394 terminals versus 27 for `PE_M_Grd_AirFlow`. History 6 still holds: no silent per-terminal fallback; the project confirms one slot.
- A4 Fan sheets acquire `from` every port of the unit (both sides); an ERV's read also carries its second fan (ponytail ceiling).
- A5 The C# `from` walk stops at mechanical equipment with more than two ports; two-port inline equipment (silencer, heater, dehumidifier) passes with an unknown drop.
- A6 Inputs (slot, split policy, end cfm, drops, join rulings) persist in per-document Work for now; the model store is the later home. Firm defaults (shim terminal drop, split policy default, slot) live in the /ducts route settings beside supply colours and slots, behind one `defaults` object the engine takes (kaitpw: interim home, clean seam).
- A7 The new surface is a separate `/sheet` route; `/ducts` is untouched.

**Questions**
- Q1 RULED (kaitpw): no ruling. The fan is where air starts and the terminal where it ends, so the ends assign the sides (supply terminals or another fan's inlet = discharge; return/exhaust terminals or an OA louver = inlet); port metadata only breaks ties. Utopia fix is flipping the family in Revit.
- Q2 RULED for the interim: route settings (see A6); the firm table's owner and values are open, productionize later.
- Q3 OPEN, parked by kaitpw: ASHRAE prices the paired elbow about 25% below Manual D 8-A2 (W1-D); is the Manual D option needed before engineers trust sheets?
- Q4 RULED (kaitpw: likely a modelling defect, and not first-principles information to control): a tap entered from its branch, and an air-type change such as an ERV supply entering a fan-coil return, end the path as `joins-other-fan`, priced up to the merge; no blocker, no ruling.
