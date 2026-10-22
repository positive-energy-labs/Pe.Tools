# Pressure drop: why not just use Revit

The question every supervisor asks. Revit ships a duct pressure-drop calculator, a critical-path
report, and ASHRAE fitting tables. Pe computes the number itself and writes results back. This
doc holds the behavior-proven reasons, each with its stamp, and the one honest answer to "then why
write anything to Revit at all". Proofs live in `LEDGER.md` Decided and Tried & rejected; this
doc only arranges them for a reader who did not sit through the campaign. Where a claim is not yet
proven it says so, and should not be repeated to a supervisor as fact until it is.

Short form: Revit's arithmetic is right, its inputs are unreachable. The fitting coefficients it
multiplies by are not readable, not schedulable, not editable in bulk, default to zero without an
error, and the automatic ASHRAE route that was supposed to fill them computes zero. Pe is the
missing reader and bulk editor; Revit stays the carrier of the result.

## The reasons

### 1. The fitting coefficient has no reader and no bulk editor

A fitting's loss method and coefficient are not Revit parameters. They are a loss-server entity
stored on the fitting instance by server GUID (`dotnet/Pe.Revit.Global/Lib/Mep/DuctApplier.cs`
writes the Specific Coefficient schema's one `Coefficient` field by GUID
`5a598293-1504-46cc-a9c0-de55c82848b9`). Schedules list parameters, so nothing in Revit can
tabulate, filter, or mass-edit this value. It is per instance with no type default. The only
place a person meets it is the Properties palette, one fitting at a time. On Project A that is
hundreds of fittings per supply system across 67 supply systems.
Stamp: PROVEN[storage shape in `DuctApplier.cs`; LEDGER Decided 2026-10-04 "nobody fixes it"].

### 2. The default is zero, and zero raises no error

An unset fitting contributes 0 to the critical path. Revit reports a confident static pressure
that is only friction plus whatever few fittings someone happened to set. Nothing flags the
omission. SA 26 on Project A: Revit 0.0205 in-wg against Pe 0.2016 after the fittings were
priced. Stamp: PROVEN[session `pdrop-drive`, Project A detached, LEDGER Decided 2026-10-04].

### 3. The automatic ASHRAE route computes zero

"Coefficient from ASHRAE Table" is the route that should fill reason 1 for free. On every duct
fitting it computes 0, in R2025 and R2026, also after Autodesk's own registry cleanup. There is
no setting that repairs the lookup. What a person *can* do is switch each fitting to "Specific
Coefficient" and type a number, which is exact (Revit 0.1105 against 0.1107 by hand), but that
returns you to reason 1: 600 numbers, typed one at a time, with nothing to look them up in.
Pe's table layer exists to do that lookup from the same ASHRAE grids Revit ships, and write the
result into the slot Revit does honor.
Stamp: PROVEN[session `walkthru`, R2025 detached copy; LEDGER Decided 2026-10-04].

Correction, 2026-10-05: the route is not dead; it is empty. A fitting on this method stores no table until a
person presses OK in ASHRAE Table Settings, and an empty fitting computes 0. Project A round elbow 9447852 (7 in,
r/D 1.0): as found no entity and coefficient 0. After OK with the dialog's highlighted CD3-11 it stored
`CoefficientFromTable.ASHRAETableName` (schema `762a2314-1d1c-4087-a58f-bab902f57be5`) and Revit charged
0.0733, CD3-11's grid at 7 in to four digits. CD3-11 is a flat-back elbow, though; the shape is CD3-2, fourth in the
same list, and the highlight is only the first name in string order. Written by API through Not Defined then the
ASHRAE server with CD3-2, Revit charged 0.24, CD3-2's grid exactly (0.00249 in wg at 408 fpm). Writing the entity
without passing through Not Defined changed the stored name and not the charge. The dialog's list does filter by
geometry (the r/D 1.5 tables CD3-1 and CD3-9 were absent). So reasons 1 and 2 stand (no reader, no bulk editor,
zero by default), and the elbow 6648777 case (no applicable table) still stands, but Pe could write the table
name and let Revit do the lookup instead of freezing a coefficient.
Stamp: PROVEN[session, controlled `ducts-ground`, R2025 detached Project A copy, kaitpw's OK by hand then API
writes `.artifacts/runs/ducts-ground/table-write2.csx`, reads `table-id.csx`, 2026-10-05 morning, nothing saved].
UNPROVEN[two-axis tap tables, recalculation after a flow or size change, a forced name on a fitting with no
applicable table].

Second reading the same morning, which narrows the correction. 388 of the model's 4571 fittings already store a
table (221 of them CD3-11, a flat-back elbow, on round elbows; 40 CD3-17, a mitered 45 degree elbow), and where a
fitting is stored and confirmed Revit charges the grid exactly. The earlier "0 report a drop" census read
`RBS_PRESSURE_DROP`, which is empty on these fittings; the palette value is `RBS_DUCT_PRESSURE_DROP`. On a tap the
table route is direction-aware and computes: takeoff 6648809 with SD5-10 charges its branch section C 0.89 and its
main section C 0.13, which reason 4's single number cannot. The API write has a limit: twin 5 in elbows, identical
in every parameter and stored entity, took the same forced write differently. 6752819, confirmed in the dialog once,
charged CD3-2 at 0.30 exactly; 6751193, never confirmed, charged 0 for CD3-2 and for CD3-11. A census of charged
and zero fittings falsified flow direction (connector 1 or 2 in) as the cause. Re-setting the same loss method in
one transaction does not recalculate; the hop through Not Defined does.
Stamp: PROVEN[session, controlled `ducts-ground`, R2025 detached Project A copy, `.artifacts/runs/ducts-ground/`
`tables-census.csx`, `legs.csx`, `table-exp*.csx`, `diff.csx`, `dir-census.csx`, 2026-10-05 morning, nothing saved].
UNPROVEN[what the dialog sets that the API cannot see; owed test: kaitpw presses OK on 6751193].
Then an inapplicable name written by API onto a working elbow (CD3-1, r/D 1.5 only, on the r/D 1.0 elbow 9447852;
CR3-1, a rectangular elbow, on 6752819) did not stick: after the hop both read CD3-11 and charged it. Revit
substitutes the first applicable table in string order, which is how 221 elbows came to hold CD3-11. So the matcher
is the gate: the API cannot place a table the dialog would refuse, and a fitting the matcher finds nothing for
charges 0 whatever is stored. Answered by kaitpw by hand: 6751193's dialog lists None with OK greyed, while its
twin 6752819 lists six. So counsel's "never confirmed" guess above is withdrawn; the matcher serves 6751193 nothing.

The matcher, as a fit to what was seen (PROVEN as a fit only): it keeps the tables of the fitting's part type, shape
and system classification whose title angle equals the fitting's angle and whose title states the fitting's r/D, a
range holding it, or no r/D. For a 90 degree round elbow at r/D 1.0 that is exactly CD3-2, 11, 12, 15, 20 and 21,
the list kaitpw saw; for 45 degrees at r/D 1.0 it is CD3-4 and CD3-17, and CD3-17 sorts first as text, which is why 40
round elbows store a mitered elbow's table. Construction (die stamped, gored, mitered, flat-back) is never checked;
the Revit family does not carry it. CD3-11's title says flat-back; its diagram shows a round inlet, a square W = H = D
body with a bolted back plate, and a round outlet, and its grid depends on D only, so it passes any r/D.
UNPROVEN[why the twins differ; proof plan on the control panel, point 4].

The rule is now PROVEN from its source, not only fitted. Revit reads `ASHRAE.xml` beside the `.tbl` grids (231
tables), and each table carries test formulas: CD3-2 `Theta == 90`, `r/D == 1.0`, `3.0 <= D <= 10.0`; CD3-11, 15 and
20 only `Theta == 90` and a size range; junctions add flow ratios (`0.01 <= Qb/Qc <= 1.0`), so a dry branch gets no
table. Autodesk's product line manager (Martin Schmid, Revit MEP forum thread "Duct Fitting & ASHRAE Table",
2022-02-08) confirms the rest: nothing tests construction, CD3-11 tops most lists alphanumerically, and Revit
measures Theta and r from connector locations, not parameters. For 6751193 that leaves one failing test: its
connector-measured Theta is not exactly 90. Then PROVEN on a fresh copy: 6751193 bends 90.00128966 degrees (connectors
and its Angle parameter agree; the palette rounds to 90.00), its twin exactly 90. A decoy probe (write CR3-1 through
the hop; replaced means offered) on 36 sampled elbows sets Revit's tolerance between 1.25e-7 and 3.1e-7 degrees. Of
1235 round elbows near 90 degrees on Project A, 87 are 6e-6 degrees or more off and can never hold a table: about 7%,
from ducts drawn a hair off square in a plan rotated 10.68 degrees to the project axes. Corrected the same day (control panel `Pages/pdrop-tour`, `offaxis.csx`, 1235 elbows): plan rotation is not the cause; a duct a hair off its direction is. On-axis elbows refuse at 5.5%, 45-degree ducts at 4.5%, almost-on-axis at 45%; 10.68 degrees describes only the ducts at 6751193. The same probe showed the
Not Defined hop alone stores the first offered table on a bare fitting: the hop is Revit's auto-assign.
Stamp: PROVEN[session, controlled `ducts-ground`, R2025 detached Project A copy reopened 2026-10-05 12:11, `theta.csx`,
`probe-census.csx`]. An attempt to square the ducts by script snapped one to the world axes, broke two joints, and the
copy was discarded and reopened; the by-hand squaring test is owed.
Consequence for Pe: the matcher is a readable file, so a lint can say exactly which tables Revit will offer each
fitting, which it defaulted to, and why none.
Not adopted from a web summary kaitpw relayed: the ASHRAE Registry Cleanup fixes a missing settings UI in R2025,
which this machine does not have (tried 2026-10-04, no change); "misaligned connectors" (Autodesk article, 403 to
fetch) is consistent with Schmid's connector-location statement but unread.

### 4. A tap holds one coefficient, physics needs two

A takeoff or tee is two fittings in one body: the branch leg (Cb, on the branch velocity
pressure) and the straight leg (Cs, on the main's downstream velocity pressure). Under Specific
Coefficient Revit stores exactly one number per fitting (reason 1's one `Coefficient` field), so
Revit's path can be right for the grille on the branch or for the grilles further down the main,
never both. Revit's own ASHRAE route is direction-aware internally, but it is the route that
computes zero (reason 3). Pe computes both legs with the right basis for each
(`ts/apps/web/src/ducts/loss-rules.ts`).
Stamp: PROVEN[storage shape] for "one number". UNPROVEN[which velocity pressure Revit multiplies
the single number by on a tap; needs one fresh-lane write-and-read on a known takeoff].

### 5. The largest term has no Revit source at all

The grille's own drop from its catalog (neck size by CFM) is usually the biggest single number
on the path. Revit has nowhere to look it up. It can only carry a number a person supplies, and
only in a family parameter bound to the terminal's connector: `Connector.AssignedPressureDrop`
is refused even on a Specific Loss connector.
Stamp: FALSIFIED[session `pdrop-w3`, terminal 6753917] for the API setter; the catalog join is
owed (LEDGER Owed).

### 6. Full connectivity is hard, and the fixes have no bulk interface

Revit's critical path needs one whole connected network from air mover to every terminal.
Revit shows disconnects one warning at a time and names systems by `MEPSystem`, which is not the
connected graph: on Project A 45 connected groups carry more than one system name and 31 mix
supply, return and exhaust. There is no Revit view that lists every open end, loop, missing root
or multi-root across the document with a verb to resolve it. Pe reads the connector graph and
lists them.
Stamp: PROVEN[deterministic, Project A snapshot census, LEDGER Decided 2026-09-26 from `ducts`].

### 6b. Base equipment: a UI fix, necessary and not sufficient

Adjacent to reason 6 and weaker than reasons 1 through 5. A system computes a critical path only
from its one base equipment. The Properties field (System Equipment) is read-only; Modify | Duct
Systems > Select Equipment sets it in seconds. On Project A no system has one (the census's 0 of
722), but this alone is not a reason to avoid Revit. Nor does it unlock the calculation: with
SA 19's base set, the system stayed not well connected, static pressure read 0, there was no
critical path, and a main duct feeding a 109 cfm tap still read 0 cfm and Bidirectional at both
ends. Connectivity (reason 6) still gates it. The unit side half-mirrors reason 5: every unit
supply connector reads 0 pressure drop like the grilles, and Preset flow at 0 cfm, whose effect on
Revit's calculation is unproven (LEDGER Owed).
Stamp: PROVEN[session `tour3`, controlled, R2025 detached Project A copy, SDK beta.171,
2026-10-04T22:50Z].

What "well connected" is not. After kaitpw closed every open end of SA 19 (2) by hand (the Tight
joint, two caps), a walk over every HVAC connector from the MSVT18 reached all 47 of its elements,
found no open end, no loop and no In-to-In or Out-to-Out joint, and Revit still said not well
connected, with Static Pressure empty and 18 of its 19 sections null. Meanwhile SA 19 (3), a lone
grille with an open connector, read well connected at 0.00 in-wg. So the flag is not about open
ends. Revit's flows on (2) were inconsistent: the main off the unit 0 cfm, the trunk 200, one duct
-200, the downstream main 200, where two 200 cfm grilles should sum to 400 on all of them. Revit
had decided a direction it could not reconcile. `Connector.AssignedFlow` on the unit's supply
connector was refused ("Fail to set assigned flow"), so the configuration is not Preset as read
earlier, or Revit refuses it on equipment; the walkthrough's step 4 (Edit Family, Flow
Configuration) is the remaining way to test the unit-flow hypothesis. Analyze > Check Duct
Systems is Revit's own reader of the reason and was not run before Revit was closed.
Stamp: PROVEN[session, controlled `tour3`, ReadOnly scripts `.artifacts/runs/pages-tour/
flow2.csx`, `preset.csx`, 2026-10-04 about 23:50 local] for the readings; UNPROVEN[the cause].

### 6c. Revit refuses the joint, so drafters draw it in

The commonest break behind reason 6 is not carelessness. A round branch dropping into the side of
a plenum or a main needs a takeoff, and the shipped Round Takeoff has a fixed 4 in length. When
the elbow sits 4.02 in off the plenum face Revit raises "There was not enough room to place the
required fittings" and places nothing, so the drafter draws the duct into the box and moves on.
Every view shows it joined; the connector graph does not. Project A census: 465 open ends, 69 with
the tip inside another element's solid, 187 touching one, 80 within 6 in; 336 of 465 (72%) sit in
or against something. Only 129 look like honest open ends. The inside cases are overwhelmingly
round stubs driven into rectangular mains, plenums and elbows.

The cause is arithmetic, not a routing rule: the takeoff is picked from the round branch type's
junction rules, and the joint needs the tap's length plus about 0.1 in of duct. A new family
"Round Takeoff - Tight 1 in", first in the junction rules of a duplicated round type used only for
these drops, connects the real joint; overwriting the shipped Round Takeoff instead broke taps
across the model. It is not a cure: of 5 census joints tried, 2 connect without it, 1 is still
0.03 in short, 2 have no room for any tap.
Stamp: PROVEN[session, controlled `fitroom`, R2025 detached Project A copy, API
`NewTakeoffFitting`, 2026-10-04 20:02 to 20:13 local; census is agent testimony from ReadOnly
scripts on `tour3`, `.artifacts/pdrop/revit/fitting-room/`]. The UI half is also PROVEN[session,
controlled `tour3`, windowed, kaitpw by hand 2026-10-04 about 23:40 local]: with the family loaded
and a duplicated "Round Duct : Taps Tight" type, drawing from the elbow into the plenum face raised
no dialog and placed Round Takeoff - Tight 1in 13008772, joined to a 1.02 in duct 13008755 and to
the plenum 8750125 (read back through the connector graph, not the view).

Two template facts behind it, read from the same model: all 14 duct types carry one junction rule
each for takeoff and tee with the size criterion "all", so nothing in the routing preferences
varies by diameter; and the shipped Round Takeoff's length is the instance parameter Takeoff Fixed
Length, driven by the family formula `if(Duct Diameter > 1' 4", Duct Diameter * 0.25, 0' 4")`
(SMACNA's quarter diameter with a 4 in floor). A formula-driven instance parameter is read-only in
the project, so the floor moves only by editing the family; the Tight family is that formula with
the floor at 1 in, saved under a new name. 2129 of
the model's 4082 ducts ride "Round Duct : Taps" with that takeoff first.

### 6d. A closed system stays "not well connected" until three family faults are fixed

Model-wide census of every duct system (335 `MechanicalSystem`s, 0 with base equipment), read
by `IsWellConnected` against the facts Revit could be judging. Closed systems (no open End
connector) read well connected 1 time in 116. Systems with exactly one open end read well
connected 67 times in 110; the open end stands in for the missing base. Every closed system that
holds equipment and terminals (23) reads false. So on this model the flag counts open ends, and a
drafter who closes the last gap turns it red.

The cause, found by committed writes on EX 31 (closed, one Broan ERV, 4 exhaust grilles, 16
sections) and read back after each step:

| Step | well connected | static | duct flows |
|---|---|---|---|
| as modeled | false | none | 10 ducts at 0 cfm |
| base equipment set (`NewMechanicalSystem` with the ERV connector) | false | none | unchanged |
| ERV family connectors Preset 0 cfm to Calculated, reloaded | false | none | 10 ducts negative |
| exhaust grille family connector In to Out, reloaded | true | 0.08 in-wg, 5 critical sections | all positive |

Revit named none of the three. All three are template content: the base equipment that no
system has, the unit connector preset at 0 cfm, and the terminal connector direction. The
family-level census of the model (45 families opened) finds them everywhere: 82 return and 51
exhaust grilles (Price LBP15A) with In connectors where Revit's convention for air leaving the
terminal is Out; 163 equipment instances whose connectors are Preset at 0 cfm (SunTherm 33,
Aprilaire 29, both Broan ERVs 35); 754 Round Takeoffs and 188 Rectangular Takeoffs with no length
parameter (only Default Elevation); 6 fan, silencer and hood families on the Global or OtherAir
classification. SA 26 (one open duct end) stayed false after the base was set.

Lane notes. `NewMechanicalSystem` must be called before any `Regenerate` after deleting the old
system, or the base connector reads "has been used". Inside the scripting ReadOnly guard the new
system never receives its ducts (they join at commit), so this proof needs `WriteTransaction`.
The committed delete and both family reloads raised Revit dialogs that kaitpw dismissed by hand
in the windowed session; `EditFamily` across 45 families raised more. Budget dialogs before any
family write on a windowed session.
Stamp: PROVEN[session, controlled `ducts-ground`, R2025 detached Project A copy of 2026-08-11,
windowed, SDK beta.172, 2026-10-04 late, nothing saved; scripts and outputs in
`.artifacts/runs/ducts-ground/` (`probe2.csx` census, `write-base.csx`, `reload-erv.csx`,
`reload-exh.csx`, `read-base.csx`, `lint.csx`)]. UNPROVEN[whether SA 26 computes once its open
end is capped and the SunTherm connector is Calculated; whether Revit's 0.08 matches a hand sum].

### 6e. Pe's snapshot sees the drawn-in joint against ducts, not yet against fittings

The 6c census used Revit solids. The same classification run on Pe's own whole-document snapshot
(centerline polylines and sizes, no solids) against duct bodies only: INSIDE 38, TOUCH 53,
WITHIN6 56, against the solid census's duct-target rows 37, 63, 51, in 17 s of Python. Node
targets are the gap: a sphere per node inflates INSIDE to 137 against 69, and Revit's axis-aligned
bounding boxes (5226 exported) inflate it to 198, because an elbow's or a grille's box is mostly
air. So node containment needs the solid, and the solid lives in Revit: the classification of an
open end (inside, touch, within, isolated, with its target) belongs in the C# snapshot at read
time, 13 s for the model, and TS consumes it as a fact.
Stamp: PROVEN[deterministic, `.artifacts/runs/ducts-ground/spike-contain.py` and `spike2.py`
over the `ducts-w1-20261004` snapshot plus `boxes.csx.out.json`, 462 open ends, 2026-10-04 late];
UNPROVEN[per-id agreement with the solid census; only class totals were compared].

### 7. Revit's calculation is a runtime hazard in R2025

`Connector.Flow` under network-based calculations is an uncatchable access violation. A
SubTransaction rollback after a server change swallows the recalculation. These are worked
around at their code sites. Stamp: PROVEN[LEDGER Decided 2026-10-04, Revit 2025 footguns].

### Not yet a reason: "keeping the Revit calc on slows the model"

Plausible, unmeasured. The ledger holds no timing of Revit's recalculation; the only timing on
record is Pe's whole-model read at 1.85 s. Apply no longer switches the document's engine (LEDGER Decided 2026-10-05); network-based calculations on a large model
are unmeasured. Do not state this to a supervisor until it has a number.
Stamp: UNPROVEN[no measurement].

### The map of what is left: the control panel page

Every reason above now has a stop on the Ducts control panel (`Pages/pdrop-tour/`, outside git, served by the
dev host): several real elements per reason, a counterpoint for Revit, the Revit UI path, check scripts that read
the model and heal scripts that write the scratch copy, and a roadmap of every fix with its status and where it
should live (Revit UI, family, template, ruling, Pe lint, Pe compute). Statuses and tries persist in the page's
host log, so the page is the record of progress; this doc keeps only settled reasons. Tally at rebuild, 2026-10-05:
11 of 19 fixes live in Revit, a family or the template; 7 are Pe product work (the lint list, open-end
classification in the snapshot, the coefficient write, the grille catalog, the hand-calc reader, the engine rule).
One new reading from its census: after the exhaust-grille reload on the scratch copy, closed systems reading well
connected rose from 1 of 116 to 8 of 116, so one family fix repaired seven systems' flags unseen.
Stamp: PROVEN[session, controlled `ducts-ground`, R2025 detached Project A copy, the page's census and lint checks
2026-10-05 about 01:00 local, nothing saved].

## Flagged for the supervisors (temporary; do not revisit until they answer)

- One system name across several units. Project A SA 19 holds two air handlers and a dehumidifier.
  By connector graph two of them are joined and reach 8 of its 11 grilles, the third reaches 2
  and nothing else, and 1 grille is reached by neither. Reason 6 found the mirror case (one
  connected group carrying several names). Ask whether one system per area was intentional, for
  view graphics or filters by system name. Counsel guesses yes: nothing read these systems for
  calculation or BIM, so separate assignment never mattered. If so, Pe should not call a
  multi-unit system a modeling error, and splitting it (Divide System per unit, then Select
  Equipment) is a change the firm has to agree to.

## Then why write anything to Revit

Because Pe is the calculator and Revit is the carrier, and both roles are needed.

- **The model is the deliverable.** The firm hands over an `.rvt`, not a Pe page. Coefficients,
  fan statics, terminal drops and the flows they were priced on travel with the model to anyone
  without Pe: reviewers, other firms, Revit's own report, Revit's sizing.
- **Revit's path is the check that the model became whole.** Once the slots are filled, Revit's
  critical path is an independent arithmetic over the same connectivity. If it reads zero or
  stops short, the network is broken, and that is worth knowing. The LEDGER ruling: Pe computes
  its own number; Revit's is the check (Decided 2026-10-04).
- **One flow, not two.** The flow Pe priced must be the flow in the model, or the two numbers
  drift silently. That is why RHVAC CFM is written to the terminals through Pea rather than only
  compared (kaitpw ruling 2026-10-04).

What the write cannot buy, honestly: reason 4 and reason 5 mean Revit's critical path will read
*close to* Pe, never exactly, at every tap and every grille. "Revit matches Pe to five digits" is
true only on paths without taps (the exhaust proof, session `pdrop-w3`). The acceptance test is
therefore never "Revit equals Pe". It is "Revit's path is nonzero, whole, and within the tap and
grille error of Pe's", and Pe's number is the one on the drawing.

## Reconciling with "write to Revit"

The apparent contradiction: if Revit's calculator cannot be trusted with the inputs, why feed it.
The resolution is that the write is persistence and transport, not delegation of the arithmetic.
Nothing in reasons 1 through 7 says Revit multiplies wrong. They say Revit cannot *obtain* the
right multiplicands, cannot show whether it has them, and cannot hold two at a tap. Pe obtains
them, shows them, writes the one Revit can hold, and keeps the full set itself in the
`_PE_DuctLosses` blob so the next person can see what was written and from which table.

## What a product has to do (ideas, filed 2026-10-04, nothing built)

Every reason above is a different kind of wrong, with a different owner and a different fix. A
single score, or one red color, would hide that. The organizing idea is a **system health page
with axes**, one row per connected group (the graph, not the `MEPSystem` name; reason 6), one
cell per axis, where each cell is a word and a count, never a color alone, and each word opens the
list of elements with the one verb that resolves them. Red flags are of different species:
"cannot place" is a content problem, "unpriced" is an input problem, "broken" is a geometry
problem, and the page should never let a reader confuse them.

| Axis | What it reads | Red flag species | Fix verb, who owns it |
|---|---|---|---|
| Geometry | open ends classed inside, touch, within 6 in, isolated, open-to-open butts (6c census method) | drawn but not connected | heal (below); the drafter, or Pe on approval |
| Room | for each drawn-in joint, stub length minus depth against the tap floor | "needs Tight 1 in" is a different flag from "no room for any tap" | load the family, or move the stub; content owner |
| Topology | no root, many roots, loops, one name over several groups, one group over several names, supply stubs touching return (6, 6b) | mis-assigned, not broken | Divide, Select Equipment, a split assistant; the designer, after the supervisors rule |
| Content | fitting families no loss rule claims, unit connectors Preset 0 cfm, terminals with no drop slot, families with no catalog (1, 5, 6b) | the firm standard is missing | the firm Pod; Pea proposes rules |
| Inputs | fittings with no ASHRAE table stored (the route is empty, not dead), terminal drops 0, fan static blank, flows masked under the network engine (2, 3, 4) | priced at zero, no error | Pe apply |
| Check | engine flag, base equipment present, Revit's path nonzero and whole, Revit against Pe within the tap and grille error (7, the Check ruling) | Revit disagrees, or stopped short | Pe reads, the person judges |

Above the table, the document-wide counts per axis; a firm with 67 supply systems cannot visit
each one. Below a cell, the elements, each with its Revit UI path as well as Pe's verb, because
every agent and most drafters are first-time users of Revit's fiddly native fixes.

Ideas per shortcoming, by cost:

- **Content kit, shipped as the firm Pod.** The Tight takeoff family, a "Taps Tight" duct type
  with it first in its junction rules, the loss rules, the grille catalog, the TerminalDrop and
  FanStatic parameter bindings. One load per template. Fixes 6c for the common case before it
  happens, and makes reasons 1, 5 and the unit half of 6b a standard instead of a per-project chore.
- **Joint healer, proposals only.** For each inside-deep stub with room: `NewTakeoffFitting` with
  the Tight type, shown as a proposal with the before and after picture, applied on approval.
  Without room: "shorten the stub by N in" or "no tap fits; move the drop", also as a proposal.
  Never silent. This is option 2 of the open ruling, scoped to the geometry the census can prove.
- **Virtual heal, as an assumption.** Pe's own graph joins a stub to the element it ends inside and
  says so on the path: "assumed joined; Revit disagrees". Option 3 of the ruling; it never leaves
  Pe's number waiting on Revit's connectivity, and it keeps Revit's path as the check once the
  real joints land. Distinct from `ignore`, which drops the end.
- **Base equipment guard.** Divide System and element deletes clear it silently (6b). Pe records
  which unit was base per group and re-proposes it when it goes missing; where a group holds one
  air mover, propose that one.
- **System assistant.** Connected groups against system names, side by side, with "split here" and
  "merge these" proposals. Hold the multi-unit case as a question, not an error, until the
  supervisors answer (Flagged section).
- **Unit connector check.** Preset at 0 cfm on every unit supply connector is a modeled-in zero,
  the unit mirror of reason 5. Propose Calculated or write the unit's flow; prove which one
  Revit's solver honors first (LEDGER Owed).
- **Precision and teaching at the element.** Revit prints pressure at 2 decimals, which hides a
  fitting's loss; Pe prints 4 and shows C, the velocity pressure and the product on the fitting,
  as the tour page does. A number a person can check is the only number they will trust.
- **Flow masking warning.** Under network-based calculations a closed group without a working air
  mover solves to zero and masks the designer flows (LEDGER Owed). The Inputs axis should say
  "masked by Revit's solver", not "0 cfm".

The health page is the surface; the kit, the healer and the guards are what make its cells go
green. Open: the product does not need all six axes on day one. Geometry and Inputs are the two
the campaign has proofs for; the rest wait on the rulings they cite.
