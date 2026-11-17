export const peaGuide = { instructions: "", skills: [
  {
    name: "place-mep-ducts",
    content: String.raw`---
name: place-mep-ducts
description: Lay out ductwork in Revit - rough in a supply, return, or exhaust trunk on a level, branch to air terminals, draft a collision-free layout the user can refine, then commit real ducts and fittings. Use for lay out ductwork, run a duct, rough in supply on a level, route duct to these terminals, duct clash check.
---

# Lay Out MEP Ducts: DECLARE -> SOLVE -> DRAFT -> DIFF -> COMMIT

You do not hand-draw ducts. You DECLARE intent as JSON; the Pe.Revit.Placement library routes collision-aware paths on a lattice and DRAFTS native placeholder ducts (visible; the user can drag them); you read the report and a plan image, refine the intent, re-SOLVE and read the DIFF; when it is clean you COMMIT real connected ducts and fittings. Use these five words with the user and repeat them when reporting.

Pe.Revit.Placement is an explicit-reference library already available in the scripting environment. Drive it from short scripts via pe_do key=op:scripting.execute - one tiny script per step. Solve, Commit, and Cleanup need permissionMode WriteTransaction; Scout, MapProbe, and ExportPlan are read-only. Every method returns its full report as text: WriteLine it and read it.

    using Pe.Revit.Placement;
    var place = new DuctPlacer(doc, "L3");   // level name or id; plan and 3D views auto-resolve
    WriteLine(place.Scout());                 // recon: terminal ids, connector z, existing duct band, level convention

## Clarify before declaring (ask, do not guess)

1. Level, system (Supply Air / Return Air / Exhaust Air), and zone: which rooms, from where to where.
2. Trunk size (default 12x8 in) and elevation above the level (default 9 ft centerline). Scout prints the level's existing duct band - match it or dodge it deliberately, and say which.
3. Terminals to serve, and connect vs near: in finished models terminals are already fed, so drops end about 1.8 in short (near-connect). That is the expected, correct outcome, not a failure. The bound is 6 INCHES: any path end more than 6 in from the connector it serves is unfinished routing, not a stub - never call it done, and never round a missing vertical leg down to a stub.
4. Where the air comes from or goes to: if an endpoint is equipment (fan, AHU), its connector has its own z - Scout prints it. A trunk at elevationFt does not descend to equipment by itself. Either run the trunk band at the equipment connector's z, or close the vertical with the Verbs session (StartAt at the equipment XY, RiseTo the trunk z, Toward the run). Check the reported endpoint z against your trunk z BEFORE calling anything connected.
5. Keep-outs (shafts, pads, future equipment) become constraints.keepOut boxes.

Hand back when the user wants specific fitting families, sloped or insulated duct, sizing calcs, or edits to EXISTING ducts. This ability only places new PEA-TK-PLACE-tagged geometry. Stop and ask when the same intent fails twice - show the refusal diagnosis verbatim.

## The loop - THREE scripts, not ten

Tool calls are your scarcest resource: each one costs a full round trip, and a placement that spreads intent-probe-solve-commit across separate calls will run out of turn before it commits. The library is in-process, so everything after recon fits in ONE script.

1. SCOUT once per level (read-only). Endpoints and terminal ids come from Scout, NEVER from an image. Do not export or read images during recon.

    using Pe.Revit.Placement;
    WriteLine(new DuctPlacer(doc, "L3").Scout());

2. PLACE - one WriteTransaction script that declares the intent inline, probes, solves, and auto-commits when clean. This template is the whole step; fill in the intent and go:

    using Pe.Revit.Placement;
    string intent = """
    { "name": "run1", "system": "Exhaust Air",
      "trunk": { "size": "10x6", "elevationFt": 9.0, "from": [384.5, 660.9], "to": [340.0, 665.0] },
      "branches": { "sizeIn": 6, "terminals": [6085577, 6612609], "connect": true } }
    """;
    var place = new DuctPlacer(doc, "L3");
    WriteLine(place.MapProbe(intent));
    WriteLine(place.SolveAndCommitIfClean(intent));
    // Clean draft -> committed + kept + plan exported, one call. Dirty or refused -> the report
    // names the blocker and the draft stays; edit ONE intent lever and re-run this script.

3. ITERATE or VERIFY. Refused or dirty: edit ONE lever in the intent (elevation first) and re-run script 2 as-is. Committed: read_image the exported plan once to confirm, then report. That is the whole loop.

A failed solve rolls back and the previous draft survives. Commit converts the placeholders that are IN THE MODEL (user hand-drags honored) into real ducts, elbows, takeoffs, and terminal connects, then rechecks collisions. Keep() retags the committed increment PEA-TK-DONE so the next Solve does not delete it. Cleanup deletes every PEA-TK-PLACE element (kept ones stay): new DuctPlacer(doc, "L3").Cleanup();

Bias to a thin first commit: get ONE collision-free draft committed rather than perfecting elevations and clearances first. Refine after the user sees something real. A clean rough-in beats a perfect un-committed plan, and it fits the time you have in one turn.

Commit is a checkpoint, not a finale. On multi-part work (trunk plus branches, several rooms, a vertical leg to equipment) commit each part as soon as its report is clean, call Keep() to lock it in, then Solve the next part - Solve DELETES everything still tagged PEA-TK-PLACE, so an increment you committed but did not Keep() is wiped by the next solve. Kept elements survive interrupted sessions and become ordinary obstacles for later solves; re-solve-to-replace only works on the increment you have NOT kept yet. If you are running out of time, commit and Keep what is clean and report exactly what remains, with the ids you would start from.

## The intent (model feet; sizes inches; unknown fields warn; bad values name valid options)

    {
      "name": "L3-west-supply",
      "system": "Supply Air",
      "trunk": {
        "ductType": "Rectangular Duct: Mitered Elbows / Taps",
        "size": "12x8",
        "elevationFt": 9.0,
        "from": [-98, 1.5],
        "to": [-40, 1.5]
      },
      "branches": {
        "ductType": "Round Duct: Taps",
        "sizeIn": 8,
        "stubFt": 1.5,
        "terminals": [1441161, 1442230],
        "connect": true
      },
      "constraints": {
        "avoid": ["mep", "walls", "structure", "equipment", "terminals"],
        "clearanceIn": 2,
        "maxBends": 8,
        "gridFt": 0.5,
        "keepOut": [ { "name": "future shaft", "min": [-70, 0], "max": [-66, 4] } ]
      }
    }

trunk.elevationFt is CENTERLINE feet above the level; match Scout's duct-band line. trunk.from/to are [x,y] model feet or an element handle. terminal ids come from Scout.

## Reading the report (route grammar)

- HIT with an obstacle z-span is a hard collision, named blocker with id and box. Each HIT carries a computed fix line - elevationFt values you can paste, or an avoid or keepOut edit. Values are approximate (bbox math): re-solve to confirm, do not argue with them.
- PASS is a wall penetration while walls is deliberately out of avoid - a human decision; flag it.
- NEAR is clear but within 12 in (TIGHT if under clearanceIn). Watch, do not chase.
- CLEAR, or a VERDICT of clear to commit, means proceed.
- The scan ALWAYS checks every obstacle group PLUS linked models (structure, architecture), regardless of avoid; avoid only steers the router. The report never lies by omission - trust it over your own guess about clearance, and never claim no collisions from a host-only check.
- ENDPOINT GAP means the trunk does not physically reach an element you declared as from or to - the run is unfinished no matter how clean the collision lines read. Apply its fix line (elevationFt or a Verbs riser) before calling anything connected; gap OK (stub range) is the done state.
- TRUNK REFUSED names the binding constraint and the blockers. Fix cheapest-first: trunk.elevationFt (z is the lever - most collisions are elevation problems, and a HIT repeating along the run means change z, never jog), then add the named group to avoid or a keepOut, then move endpoints to lanes MapProbe shows free, then maxBends, and only last clearanceIn.
- DIFF lines (z 41.17 to 40.17, collisions 1 to 0, len +1.8 ft) are the steering feedback - quote them when asking the user for a decision.

## Verbs escape hatch

For interactive nudging or diagnosing a single leg, use the fluent session (StartAt, Toward, RiseTo, BranchTo, then Preview or Commit) from new DuctPlacer(doc, level).Verbs(). Same probe voice, same marker, same draft medium. Prefer intent JSON for anything past a couple of legs - routine refinement is data edits.

## Hard rules

- Only elements with Comments = PEA-TK-PLACE are yours. Never modify or delete anything else.
- Solve, Commit, and Cleanup run WriteTransaction; Scout, MapProbe, and ExportPlan are read-only.
- read_image the exported plan ONCE after a commit to confirm before reporting success. Never read images during recon or between solve iterations - the report and MapProbe are the truth; images are the final visual check.
- On a Revit-busy error: wait, retry a few times, never stack concurrent runs.
`,
  },
] };
