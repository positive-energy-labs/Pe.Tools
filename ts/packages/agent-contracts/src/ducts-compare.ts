/**
 * The ducts comparison: Pe against native Revit and Naviate HVAC&P, row by row, part of the one
 * guide object (`ducts-guide.ts`) the tutorial, Pea's skill and the `route:ducts.guide` read share.
 * Revit's cells are the record in `docs/features/ducts/WHY-NOT-REVIT.md`; Naviate's are a static
 * read of its shipped assemblies (2026-10-20). Register as in `ducts-guide.ts`.
 */
import { DUCT_CASES } from "./ducts-cases.ts";

/** One cell of the comparison: a mark, a short note, and the evidence behind it on hover. */
export interface DuctsCompareCell {
  mark: "yes" | "partial" | "owed" | "no";
  note: string;
  detail?: string;
}

export type DuctsProduct = "revit" | "naviate" | "pe";

/**
 * One row of the comparison. `lead` names the products clearly ahead; a row another product leads
 * is on Pe's roadmap unless `outOfScope` says a ruling put it there. `unproven` marks a Pe cell that
 * is built and not yet seen working.
 */
export interface DuctsCompareRow {
  feature: string;
  revit: DuctsCompareCell;
  naviate: DuctsCompareCell;
  pe: DuctsCompareCell;
  lead?: readonly DuctsProduct[];
  unproven?: true;
  outOfScope?: true;
}

const no = (note = "None", detail?: string): DuctsCompareCell => ({ mark: "no", note, detail });

/**
 * Pe against native Revit and Naviate HVAC&P, the question a supervisor asks first. Revit's cells
 * are the record in `docs/features/ducts/WHY-NOT-REVIT.md`; Naviate's are a static read of its
 * shipped assemblies. Manual D is not a column: it is a sizing method, and where it differs the
 * row says so in its detail.
 */
export const DUCTS_COMPARE: readonly { group: string; rows: readonly DuctsCompareRow[] }[] = [
  {
    group: "See and find",
    rows: [
      {
        feature: "Every system at once",
        revit: {
          mark: "partial",
          note: "System Browser lists systems, with no pressure beside them",
          detail:
            "A system's number shows only in the System Inspector or a report, and every number read on open is stale until that system is touched.",
        },
        naviate: no("One network per run"),
        pe: { mark: "yes", note: "Every system listed with its worst-path ESP" },
        lead: ["pe"],
      },
      {
        feature: "Start from a Revit selection",
        revit: { mark: "yes", note: "System Inspector starts from the selection" },
        naviate: { mark: "yes", note: "Pick one duct, fitting or air handler" },
        pe: no("Start from a system name or the search box"),
        lead: ["revit", "naviate"],
      },
      {
        feature: "Find a system or element",
        revit: { mark: "yes", note: "System Browser; select by id" },
        naviate: no("Scope is whatever the pick touches"),
        pe: { mark: "yes", note: "Search by element id, equipment tag or system" },
      },
      {
        feature: "Show the element in Revit",
        revit: { mark: "yes", note: "It is Revit" },
        naviate: { mark: "yes", note: "A row selects it; Zoom; Hide to pan" },
        pe: { mark: "yes", note: "Select it, or section-box the 3D view around it" },
      },
      {
        feature: "A link reopens the same view",
        revit: no(),
        naviate: no(),
        pe: { mark: "yes", note: "System, camera and layers live in the address" },
        lead: ["pe"],
        unproven: true,
      },
      {
        feature: "3D picture of the system",
        revit: {
          mark: "yes",
          note: "The model; the System Inspector highlights the critical path",
        },
        naviate: no("Grids only"),
        pe: { mark: "yes", note: "The system's real meshes with its losses drawn on top" },
        unproven: true,
      },
    ],
  },
  {
    group: "Network",
    rows: [
      {
        feature: "Gaps and near misses",
        revit: no(
          "Stops at the first open end, one warning at a time",
          "On one test model 336 of 465 open ends sat in or against another element: drafters draw the joint in because Revit refuses the small takeoff that would make it. That model carried about 4,000 warnings.",
        ),
        naviate: no("An open end aborts the run"),
        pe: { mark: "yes", note: "Bridged and graded; only a missing path to a fan blocks" },
        lead: ["pe"],
      },
      {
        feature: "Loops",
        revit: no("The system is not well connected and has no number"),
        naviate: no("A loop aborts the run"),
        pe: { mark: "yes", note: "Priced as a tree and listed as a diagnostic" },
        lead: ["pe"],
      },
      {
        feature: "Repair joins in the model",
        revit: {
          mark: "partial",
          note: "Cap Open Ends and Connect Into, one element at a time",
          detail: "The API's cap is pipe-only, so a duct cap is a per-element UI verb.",
        },
        naviate: no("Fix by hand, then rerun"),
        pe: { mark: "yes", note: "Caps, connects and closes small gaps after a preview" },
        lead: ["pe"],
      },
      {
        feature: "Several fans on one system",
        revit: no("One base equipment per system; Divide System first"),
        naviate: { mark: "partial", note: "Choose which air-handler system to run" },
        pe: {
          mark: "yes",
          note: "Each fan priced on its own",
          detail:
            "A system name over separate networks with their own fans gets one line: split it in Revit first.",
        },
        lead: ["pe"],
      },
      {
        feature: "Set the system's fan",
        revit: {
          mark: "yes",
          note: "Select Equipment, one system at a time",
          detail:
            "Necessary, not sufficient: a unit connector left on a preset flow or a grille drawn the wrong way keeps the system unpriced until the family is fixed and reloaded.",
        },
        naviate: no(),
        pe: { mark: "yes", note: "Assign-fan, guarded and read back" },
      },
    ],
  },
  {
    group: "Airflow",
    rows: [
      {
        feature: "Which parameter holds airflow",
        revit: no(
          "The connector's Flow only",
          "The network-based engine masks a designer's flow on terminals: it reads 0 until the engine is switched back.",
        ),
        naviate: no("The connector's Flow only"),
        pe: {
          mark: "yes",
          note: "The engineer picks the firm's parameter; coverage shows how many grilles read",
        },
        lead: ["pe"],
      },
      {
        feature: "Room airflow drives the grilles",
        revit: { mark: "partial", note: "Spaces hold airflow; grilles do not follow it" },
        naviate: no("No room concept"),
        pe: { mark: "owed", note: "The rooms link is the next step" },
      },
    ],
  },
  {
    group: "Pressure",
    rows: [
      {
        feature: "Straight duct friction",
        revit: { mark: "yes", note: "Matches a hand calculation within 0.1%" },
        naviate: { mark: "partial", note: "Blasius friction, no roughness" },
        pe: { mark: "yes", note: "Altshul-Tsal with roughness" },
      },
      {
        feature: "Fitting coefficients",
        revit: {
          mark: "partial",
          note: "An ASHRAE table only after OK is pressed in each fitting's dialog",
          detail:
            "When Revit picks a table itself it takes the first allowed one in text order, often the wrong shape: on one test model 221 round elbows held a flat-back elbow's table. It measures an elbow's angle from the ducts drawn into it with almost no tolerance, so about 7% of round elbows can never hold a table.",
        },
        naviate: { mark: "partial", note: "Built-in tables of unidentified source" },
        pe: {
          mark: "yes",
          note: "Revit's own ASHRAE grids, chosen by a rule per family and type",
          detail:
            "Manual D converts a fitting into equivalent feet at one design friction rate, accurate near the velocity its table was calibrated at. ASHRAE multiplies a coefficient by the velocity pressure at the actual speed. Fittings differ from RHVAC because the methods differ, not because either is wrong.",
        },
        lead: ["pe"],
      },
      {
        feature: "Takeoff legs",
        revit: no(
          "One coefficient per takeoff; the physics needs two",
          "The branch and the straight leg run at different velocity pressures, so Revit's path is right for the branch grille or for the downstream grilles, not both. The palette shows 0 on a takeoff that its section still charges.",
        ),
        naviate: { mark: "partial", note: "Tee tables; per-leg handling not traced" },
        pe: { mark: "yes", note: "Each leg priced on its own" },
        lead: ["pe"],
      },
      {
        feature: "A fitting it cannot price",
        revit: no("Charges 0 with no warning"),
        naviate: no("Charges 0 Pa with no notice"),
        pe: { mark: "yes", note: "Listed as not priced, never zero" },
        lead: ["pe"],
      },
      {
        feature: "Results in Manual D terms",
        revit: no("Inches of water only"),
        naviate: no("Pascals only"),
        pe: {
          mark: "yes",
          note: "Every leg in equivalent feet at its own friction rate, as RHVAC shows it",
          detail:
            "Pe analyses the system as drawn with ASHRAE coefficients, then converts each loss to feet at that duct's own rate. Straight-duct friction matches RHVAC closely.",
        },
        lead: ["pe"],
      },
      {
        feature: "Critical path and fan ESP",
        revit: {
          mark: "partial",
          note: "System Inspector and the loss report, stale on open",
          detail:
            "Needs one connected network and a base equipment. On open every fitting reads 0 and each critical path is stale until its system is touched.",
        },
        naviate: { mark: "yes", note: "Worst path, with available pressure handed back down" },
        pe: { mark: "yes", note: "Per fan, with Revit's number beside it as a check" },
      },
      {
        feature: "Inline dampers, coils, filters",
        revit: { mark: "partial", note: "A drop typed on each connector" },
        naviate: { mark: "partial", note: "Dampers and silencers from the catalog" },
        pe: { mark: "partial", note: "A damper rule plus a typed drop" },
      },
    ],
  },
  {
    group: "Manufacturer data",
    rows: [
      {
        feature: "Terminal and damper catalog",
        revit: no(),
        naviate: { mark: "yes", note: "13 manufacturers, about 12,000 products" },
        pe: no(
          "Unscoped: the firm's leads price terminals last, if at all",
          "A project already reads a loaded family's lookup tables without opening the family, so a firm catalog can travel inside its families when it returns.",
        ),
        lead: ["naviate"],
        outOfScope: true,
      },
      {
        feature: "Datasheet to data",
        revit: no(),
        naviate: { mark: "yes", note: "PartMaker traces curves off a chart image" },
        pe: { mark: "owed", note: "Pea reads the sheet; a curve digitizer is filed" },
        lead: ["naviate"],
      },
      {
        feature: "Balancing and damper settings",
        revit: no(),
        naviate: { mark: "yes", note: "Damper percent, slot and turns per terminal" },
        pe: { mark: "owed", note: "A later module" },
        lead: ["naviate"],
      },
      {
        feature: "Sound",
        revit: no(),
        naviate: { mark: "yes", note: "8 octave bands, dB(A) and dB(C)" },
        pe: no("Out of scope by ruling"),
        lead: ["naviate"],
        outOfScope: true,
      },
    ],
  },
  {
    group: "Bulk edit and triage",
    rows: [
      {
        feature: "Edit many fittings at once",
        revit: no(
          "One fitting at a time in Properties",
          "A fitting's loss coefficient is not a parameter: it cannot be scheduled, filtered or edited in bulk, and has no type default.",
        ),
        naviate: no("One element per dialog"),
        pe: {
          mark: "yes",
          note: "One rule per family and type moves every instance; the row shows how many grilles move",
        },
        lead: ["pe"],
      },
      {
        feature: "Fix many problems at once",
        revit: no("Warnings one at a time"),
        naviate: no(),
        pe: {
          mark: "partial",
          note: "One heal row per network, so a whole document shows hundreds",
        },
      },
      {
        feature: "Work list of what is wrong",
        revit: { mark: "partial", note: "The warnings dialog and Check Duct Systems" },
        naviate: { mark: "partial", note: "An error log after a failed run" },
        pe: { mark: "yes", note: "Inbox: Fix, Set, Write, Diagnostics" },
        lead: ["pe"],
      },
    ],
  },
  {
    group: "Trust and write",
    rows: [
      {
        feature: "Where each number came from",
        revit: { mark: "partial", note: "The loss method on each fitting's palette" },
        naviate: { mark: "yes", note: "A Data Source column, edited in place" },
        pe: { mark: "owed", note: "A source column is filed; airflow already names its source" },
        lead: ["naviate"],
      },
      {
        feature: "Missing data reads as unknown",
        revit: no("Reads 0 with no warning"),
        naviate: no("Reads 0 Pa"),
        pe: {
          mark: "yes",
          note: "A grille with no data reads 'no drop: unknown' and never blocks",
        },
        lead: ["pe"],
      },
      {
        feature: "Preview before writing",
        revit: no("Edits apply as typed"),
        naviate: no("Writes when the dialog closes"),
        pe: { mark: "yes", note: "Old and new, line by line, before any write" },
        lead: ["pe"],
      },
      {
        feature: "Results travel with the model",
        revit: { mark: "yes", note: "Native parameters" },
        naviate: { mark: "yes", note: "Nine shared parameters" },
        pe: {
          mark: "yes",
          note: "Inputs written to the model; results recomputed on every read",
          detail:
            "The firm hands over an .rvt, not a Pe page. Flows, ESP and coefficients travel with it to reviewers who do not have Pe, and Revit's own critical path becomes a check that the model is whole.",
        },
      },
    ],
  },
  {
    group: "Help and output",
    rows: [
      {
        feature: "Built-in guide",
        revit: { mark: "partial", note: "Online help" },
        naviate: { mark: "partial", note: "Links to online help" },
        pe: { mark: "yes", note: `A six-step walk and ${DUCT_CASES.length} cases with drawings` },
        lead: ["pe"],
      },
      {
        feature: "Agent",
        revit: no(),
        naviate: no("None in HVAC&P"),
        pe: {
          mark: "yes",
          note: "Pea reads this guide, proposes values, and applies a heal after approval",
        },
        lead: ["pe"],
        unproven: true,
      },
      {
        feature: "Units",
        revit: { mark: "yes", note: "Project units" },
        naviate: { mark: "yes", note: "Metric engine, project units on screen" },
        pe: { mark: "partial", note: "Imperial only" },
        lead: ["revit", "naviate"],
      },
      {
        feature: "Report export",
        revit: { mark: "yes", note: "Duct Pressure Loss Report" },
        naviate: no(),
        pe: { mark: "owed", note: "A signed calculation export is filed" },
        lead: ["revit"],
      },
    ],
  },
];

/** True when Pe owes the row: another product leads and no ruling put it out of scope. */
export const onPeRoadmap = (row: DuctsCompareRow): boolean =>
  !row.outOfScope && !!row.lead?.length && !row.lead.includes("pe");
