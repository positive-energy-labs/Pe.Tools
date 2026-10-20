# Pressure drop: live frontier (muse, 2026-10-04)

Deleted when the document-wide manager and the catalog member kind land. Rulings go to
`LEDGER.md` Decided; this file holds only the shapes still on the table and the work in flight.

## Rulings so far (muse round 1, kaitpw)
- The manager is its own stage: per-grille interface (drawer, exception path) and per-condition
  interface (rule row).
- Flow source: write to Revit. RHVAC CFM becomes the terminal flow through Pea; Pe prices from it.
- Rule identity across documents: family and type names.
- Width: very radical. The firm Pod holds every company standard; one bundle, same experience.
- Order of work: Pe's call.

## Shapes

| | S1 Blob only | S2 Pod rules, menu conditions | S3 Geometry decides, rules are exceptions | S4 Standards bundle with catalogs |
|---|---|---|---|---|
| Rule lives | TS code; blob holds chosen tables | Firm pod member; project override in blob by key | Pe's applicability map in code; pod holds overrides only | Firm pod composes members: families, duct rules, catalogs, slots, unit defaults; blob holds overrides and receipts |
| Rule is | code predicate | `{family, type, condition-id, table}` | none by default; part type and connector geometry pick the table | S2's row, where `table` names a catalog member path |
| New family claimed by | a code change | person picks from a menu, or Pea proposes | nothing; inference or unclaimed | Pea proposes a row from inference; person accepts into project, promotes to firm |
| Catalog | ASHRAE baked in TS | ASHRAE baked in TS | ASHRAE baked in TS | a member kind: ASHRAE, Price grilles, RHVAC parser are three instances |
| Manager stage shows | tables per key | rows with claimed and unclaimed counts, source firm or project | families grouped by inferred table, overrides marked | S2's rows plus drift between bundle and document |
| Makes impossible | a firm authoring anything | a rule without a family name | a firm owning its ASHRAE choices | a number without a cited source |
| Epitaph | the Pod carries nothing a firm wrote | catalogs stay a code release | anti-Pod: the standard lives in Pe's code | none yet |

Counsel's position: S4 with S2's row as the unit and S3's inference as Pea's proposal source.
Argued against: S3 as the whole shape.

Correction after the tap diagnosis: unclaimed is per instance and condition, not per family.
Round Takeoff on Project A is claimed on 177 instances and unclaimed on 155 (collar-first entry).
Every shape's "unclaimed families" column is too coarse; the row carries a claimed count and an
unclaimed count that opens to the failed conditions.

## Anchors
- LAW, PROVEN 2026-10-04: one Specific Coefficient per fitting, and Revit charges it on every
  section the fitting belongs to, each on its own Pv (`DuctPressureProofTests`). A tap's branch and
  straight legs cannot carry different coefficients, true under Specific Coefficient only; the ASHRAE table route charges the legs separately (tap 6648809 SD5-10: branch 0.89, main 0.13). Counsel now argues: write the leg on Pe's
  critical path per tap; Revit's path is the check (`WHY-NOT-REVIT.md`).
- LAW: `Connector.Flow` is an access violation under network-based calculations; the price never
  needs it (pass-1 flows are terminal sums).
- LAW: a pod composes from its own bytes; `$schema` selects a member's library; host validates
  structure with ajv. The ducts library is TS, which the pods ledger did not anticipate.
- LORE, ruled: rule identity is family and type names; Family Foundry's standard in the same
  bundle controls those names.
- LORE: condition from a menu before any typed formula; the menu is the catalog's own axes.

## Round 2 rulings (kaitpw, 2026-10-04 evening)
- Pea proposes rules for every unclaimed family, always.
- Project overrides are managed in the UI on their own stage, beside the firm standards stage.
- Tap write: the proof withdrew "Cb only" (Revit charges the one coefficient on both legs); kaitpw to rule between the critical-path leg per tap and Cb everywhere (LEDGER Decided 2026-10-04).

So the losses route grows two stages beyond the per-grille one: **standards** (the firm bundle's
rules and catalogs as this document sees them: claimed and unclaimed counts, Pea's proposals) and
**overrides** (what this project changed against the bundle, with promote-to-firm as its verb).
Open for round 3: whether an override row is the same primitive as a standards row with a
different source, or its own shape; where Pea's proposal lands first (override, then promote).

## In flight (2026-10-04 evening)
- Collar-first tap fix landed in `losses.ts` with a test, uncommitted, suite green (LEDGER Owed has the stamp and the two UNPROVEN counts).
- Flow loss diagnosed (LEDGER Owed): 108 terminals read 0 design flow under network-based
  calculations, whole groups, Revit reports nothing for them either. Fix blocked on a session.
- Both Revit proofs landed (LEDGER Decided 2026-10-04); the test file stays as the grounding proof
  and ignores itself when no project document is open and `PE_PDROP_FIXTURE` is unset. It ran as
  `Pe.Revit.Tests/Proofs/DuctPressureProofTests.cs`, first attempted on the fresh rung
  (`pe-revit test --filter`, env `PE_PDROP_FIXTURE` = the Chadds detached copy, opened and closed
  without save, transactions rolled back): (a) tap single-coefficient velocity-pressure basis;
  (b) terminal Flow under network-based calculations. Evidence lands in
  `.artifacts/runs/pdrop-proofs-20261004/`. kaitpw ruled a second Revit beside `tour3` is fine
  (22.7 GB free).

## Lane notes (2026-10-04 evening)
- Fresh rung FALSIFIED for this fixture: a raw `OpenDocumentFile` inside a test blocks on the
  linked-DWG hatch warning dialog (`ADialog::doModal` at 18:38:02, journal 3983) and the engine
  kills the run at its 10-minute timeout. Proofs on the Chadds copy run attached: own session
  `pdrop-proof`, `pe-revit doc open ... --detach --windowed --missing-links allow` (the SDK now
  refuses a windowed detached open without an explicit missing-links policy; the old handoff
  recipe is stale), then `pe-revit test --attach --id pdrop-proof --no-build --filter ...` after a
  terminal build. The tests use the active document and close nothing they did not open.

## Order
1. Tap fix. 2. Flow-loss cause, then fix. 3. Protoui round 4 of the standards stage on the fixture
with real counts. 4. Catalog member kind, RHVAC CFM to terminals as its first write-side consumer.
