/**
 * The one source for what the ducts product does, written once and projected three ways: the
 * `/ducts` tutorial renders it for people, Pea's bundled `calc-duct-pressure-drop` skill is
 * generated from it, and the `route:ducts.guide` read returns it with the cases present in a
 * document. A line belongs here when it changes with the product and everyone needs it. Which
 * capability Pea calls at each step is operational and lives beside the capabilities; why a
 * ruling was made lives in `docs/features/ducts/LEDGER.md`.
 *
 * Register: plain third person for any engineer or reviewer. "The engineer" is the person using
 * the route, "Pea" the agent, "the route" the page. No second person, no project-specific ids.
 */
import { CASE_GROUPS, DUCT_CASES, type CaseGroup, type DuctCase } from "./ducts-cases.ts";

export { CASE_GROUPS, DUCT_CASES };
export type { CaseGroup, DuctCase };
export type { CaseExample, CaseStatus } from "./ducts-cases.ts";

/** One step of the walk: what happens, and who does it. */
export interface DuctsWalkStep {
  step: string;
  who: string;
  body: string;
}

/** Where one kind of value lives: what survives a save, who sees it, who writes it. */
export interface DuctsResidency {
  value: string;
  livesIn: string;
  survivesSave: string;
  whoSees: string;
  whoWrites: string;
}

/** One row of the method comparison: the question, then Manual D, Revit and Pe. */
export interface DuctsMethodRow {
  question: string;
  manualD: string;
  revit: string;
  pe: string;
}

export const DUCTS_SUMMARY =
  "The ducts route reads every duct network in the document from Revit's connectors, repairs what it safely can, prices each grille's path from its fan, and writes the inputs it used back into the model so they travel with it. The result is a design-grade number with its assumptions listed. It is not a certification. The engineer sees the number per grille and what it rests on, Pea proposes and previews, and the engineer rules on anything the model cannot settle.";

export const DUCTS_WALK: readonly DuctsWalkStep[] = [
  {
    step: "Name the system",
    who: "Engineer or Pea",
    body: "Pick a Revit duct system by its name. The page shows every duct network that system touches, one section per fan, and marks any network shared with other systems. The search box moves within the same read: an element id, an equipment tag, or another system.",
  },
  {
    step: "Heal the model",
    who: "Route proposes, engineer approves, Pea or engineer applies",
    body: "Pe builds the network from Revit's connectors, not from the system name. Gaps under about 2 in and near-miss taps are bridged for the calculation and listed as diagnostics. Dangling ends get a cap, touching ends get connected, and small same-size gaps get a union. These are written into Revit after a preview. Anything harder appears as a Fix row that names the repair and selects the element in Revit.",
  },
  {
    step: "Point at the airflow",
    who: "Engineer",
    body: "Choose which parameter holds each grille's design airflow on this project (a firm parameter, the family's own Flow, or whatever the drafter used). The page lists every grille's value and its source. A grille with no value becomes a Set row. A fan's flow is the sum of its grilles. Only a side-stream unit such as a dehumidifier needs a typed flow.",
  },
  {
    step: "Price",
    who: "Route",
    body: "Each duct's friction comes from its length, size, flow and roughness. Each fitting's loss is an ASHRAE coefficient times the velocity pressure at the actual flow. Each grille's path is summed from its fan, and the worst path is that fan's external static pressure (ESP). A grille's own drop is included when one is entered and never blocks the result when it is not.",
  },
  {
    step: "Read the result",
    who: "Engineer",
    body: "The tree shows every run and leg in equivalent feet at that duct's own friction rate, with inches of water beside it. The header shows total effective length and ESP for the worst fan. Selecting a duct shows its length, design and actual loss per 100 ft, roughness and fittings, in the same layout as an RHVAC section.",
  },
  {
    step: "Review and write",
    who: "Engineer",
    body: "Every pending change is listed as old and new before anything is written: airflow slot, rulings, roles, flows, ESP. A refused change says why. Write can run whenever something is staged. Only the ESP value waits for a calculation with no open Fix row.",
  },
];

/** Why the walk is not one click, and what Pea does inside it. */
export const DUCTS_NOT_ONE_CLICK =
  "It is not one click. Three things need a person on most models: which parameter holds the design airflow, the joins the evidence argues against, and approval of each write. The rest is automatic, and Pea can do the walking.";

/** What Pea does on the route, as object rights. */
export const DUCTS_PEA_DOES: readonly string[] = [
  "Puts the page on the system the engineer names.",
  "Reads every fact and finding the page shows, including Diagnostics.",
  "Proposes a value on any cell and any blocking row, with its evidence in the note.",
  "Presses survey, previews heals, and applies a heal once the engineer approves it.",
  "Previews making a unit the fan of its system, and shows the outcome.",
  "Walks the inbox in order, Fix, Set, Check, Write, and reports in the route's words: system, finding, required ESP now and staged.",
];

/** What Pea never does on the route. */
export const DUCTS_PEA_NEVER: readonly string[] = [
  "Stages a ruling or an airflow slot; typing is the engineer's decision.",
  "Writes an ESP or presses the loss write.",
  "Applies the fan assignment; it previews and the engineer presses it.",
  "Computes a pressure drop of its own, by script or by hand; the route's number is the number.",
  "Edits geometry by script; transitions, takeoffs, long gaps and anything joining two systems are the engineer's, in Revit.",
];

export const DUCTS_RESIDENCY: readonly DuctsResidency[] = [
  {
    value: "Computed losses, critical path, ESP",
    livesIn: "Nowhere. Recomputed on every read.",
    survivesSave: "No",
    whoSees: "Anyone with Pe sees the same number from the same model",
    whoWrites: "The route",
  },
  {
    value: "Grille airflow, unit airflow, unit ESP, terminal drop, fitting coefficient",
    livesIn: "Revit parameters on the element, through named slots",
    survivesSave: "Yes, with the model",
    whoSees: "Everyone in Revit, with or without Pe",
    whoWrites: "The engineer types it; Write puts it in Revit",
  },
  {
    value: "Which parameter is the airflow slot",
    livesIn: "The model's Project Information (a hidden text parameter, _PE_DuctLosses)",
    survivesSave: "Yes, with the model",
    whoSees: "Everyone with Pe, after sync",
    whoWrites: "The engineer picks it; Write stores it",
  },
  {
    value: "Rulings: ignore this open end, object to this join, this unit is passive",
    livesIn: "The same Project Information parameter",
    survivesSave: "Yes, with the model",
    whoSees: "Everyone with Pe, after sync",
    whoWrites: "The engineer rules; Write stores it; a take-back is a staged delete",
  },
  {
    value: "Caps and connections made by the heal",
    livesIn: "Real fittings and connections in the model",
    survivesSave: "Yes, with the model",
    whoSees: "Everyone, in Revit and in every other tool",
    whoWrites: "The engineer approves; Pea or the engineer applies",
  },
  {
    value: "Edits typed but not written, and Pea's proposals",
    livesIn: "Pe Work on the local computer, keyed by document",
    survivesSave: "No. Cleared by Start fresh, never saved with the model",
    whoSees: "Only this computer",
    whoWrites: "The engineer, or Pea as a proposal",
  },
  {
    value: "Firm rules (which ASHRAE table a fitting family uses), slot names, catalogs",
    livesIn: "Pe's code today; a firm Pod once the standards work lands",
    survivesSave: "Yes, with the install",
    whoSees: "Everyone with the Pod",
    whoWrites: "The firm",
  },
  {
    value: "Design friction rate",
    livesIn: "Route settings (the duct settings popover)",
    survivesSave: "Yes, in local settings",
    whoSees: "Only this computer",
    whoWrites: "The engineer",
  },
];

export const DUCTS_RESIDENCY_RULE =
  "Anything that affects the calculation is stored in the model, so another person or another tool sees the same thing. The only state Pe keeps for itself is what has been typed and not yet written.";

/** Why not Revit's own pressure drop: the supervisor's question. */
export const DUCTS_WHY_NOT_REVIT: readonly string[] = [
  "Revit's straight-duct friction matches a hand calculation within 0.1%. Its arithmetic is correct; its inputs cannot be filled in at scale, so its result is rarely complete.",
  "A fitting's loss coefficient is not a parameter. It cannot be scheduled, filtered or edited in bulk. It is set one fitting at a time in the Properties palette, with no type default. A fitting that was never set charges 0 and raises no warning, so Revit reports a static pressure that is only friction plus whichever fittings someone set.",
  "The \"Coefficient from ASHRAE Table\" option stores no table until someone presses OK in each fitting's dialog. When Revit picks a table itself, it takes the first allowed one in text order, which is often the wrong shape. It measures an elbow's angle from the ducts drawn into it with almost no tolerance, so some elbows can never hold a table at all. On one test model that was 221 round elbows holding a flat-back elbow's table and about 7% of elbows with no table possible.",
  "A takeoff holds one coefficient, but the physics needs two: the branch and the straight leg run at different velocity pressures. Revit's path can be right for the branch grille or for the downstream grilles, not both.",
  "Revit's critical path needs one connected network from the fan to every grille, and it reports disconnects one warning at a time. On the same test model, 336 of 465 open ends sat in or against another element: drafters draw the joint in because Revit refuses the small takeoff that would make it. Pe reads the graph, lists every open end, loop, missing fan and shared junction, and heals the safe ones.",
  "On open, every fitting reads 0 and Revit's critical paths are stale until the system is touched. Pe recomputes on every read.",
];

export const DUCTS_WHY_WRITE_BACK =
  "Pe still writes to Revit because the model is the deliverable. The firm hands over an .rvt, not a Pe page. Flows, ESP and coefficients travel with it to reviewers who do not have Pe, and Revit's own critical path becomes a check that the model is whole.";

export const DUCTS_METHODS_NOTE =
  "Manual D and ASHRAE are two methods. Manual D converts a fitting into equivalent feet at one design friction rate, which is accurate near the velocity the table was calibrated at and convenient for sizing by hand. ASHRAE multiplies a coefficient by the velocity pressure at the actual speed. Pe analyses the system as drawn with ASHRAE coefficients, then shows every loss in feet the way RHVAC does, converted at that duct's own rate. Straight-duct friction should match RHVAC closely. Fittings differ because the methods differ, not because either is wrong.";

export const DUCTS_METHODS: readonly DuctsMethodRow[] = [
  {
    question: "Purpose",
    manualD: "Sizing: choose duct sizes so every run meets one design friction rate",
    revit: "Analysis of a drawn system, once its inputs are filled in",
    pe: "Analysis of the drawn system as it is, with the inputs it has",
  },
  {
    question: "Lengths",
    manualD: "Typed by hand per section",
    revit: "Measured from the model",
    pe: "Measured from the model",
  },
  {
    question: "Fittings",
    manualD:
      "Equivalent feet from an ACCA table, accurate near the velocity the table was calibrated at",
    revit:
      "ASHRAE coefficient times velocity pressure, but only after a table is stored on each fitting; a fitting with none charges 0 with no warning",
    pe: "ASHRAE coefficient times velocity pressure at the actual flow, chosen by a family and type rule, for every fitting",
  },
  {
    question: "Terminals and devices",
    manualD: "Typed drops, or 0 if none were typed",
    revit: "A drop on the connector, typed per instance",
    pe: "Included when a drop is entered; otherwise listed as not priced and never blocking",
  },
  {
    question: "Broken geometry",
    manualD: "Not seen; the file has no geometry",
    revit: "Stops at the first open end, one warning at a time",
    pe: "Bridged and graded; caps and joins healed in Revit after approval; the rest listed with a repair",
  },
  {
    question: "Output",
    manualD: "Total effective length, friction rate, ESP",
    revit: "Static pressure per system, two decimals, stale until the system is touched",
    pe: "Feet per leg at its own rate, total effective length and ESP per fan, four decimals, every assumption listed",
  },
  {
    question: "Typed by the engineer",
    manualD: "Everything",
    revit: "Every coefficient, one fitting at a time",
    pe: "Which parameter holds the airflow, the rulings, the side-stream flows",
  },
];

/** Compared with Naviate's duct pressure tool. Claims come from the decompiled add-in; see the ledger. */
export const DUCTS_NAVIATE: readonly { topic: string; body: string }[] = [
  {
    topic: "Entry",
    body: "Naviate starts from one selected element and walks its connectors. Pe starts from a system name, chosen by the engineer or by Pea.",
  },
  {
    topic: "An open end or a loop",
    body: "Naviate stops the run and lists element ids. Pe bridges what it can, grades it, heals caps and joins in Revit, and lists the rest with a repair.",
  },
  {
    topic: "A grille with no catalog match",
    body: "Naviate prices it at 0 Pa without a notice. Pe lists it as not priced.",
  },
  {
    topic: "Writing",
    body: "Naviate writes nine shared parameters when its dialog closes, with no preview. Pe lists every change as old and new, then writes.",
  },
  {
    topic: "Where results live",
    body: "Naviate stores results on the elements and overrides in extensible storage. Pe stores inputs on the elements and rulings in Project Information; results are recomputed.",
  },
  {
    topic: "Manufacturer data",
    body: "Naviate ships a catalog of about 12,000 products and converts residual pressure into damper settings. Pe does not price terminals from catalogs yet; balancing is a later module.",
  },
  {
    topic: "The agent",
    body: "Naviate's assistant runs a fixed plan or returns script text and cannot see the model. Pea reads the findings, proposes values on rows, previews heals and applies them after approval.",
  },
];

/** What an engineer has to decide; the route cannot settle these from the model alone. */
export const DUCTS_ENGINEER_DECIDES: readonly string[] = [
  "Anomalous joins: a reversed connector, a part pushed through a duct, supply meeting return. The route objects and waits for a ruling.",
  "Hard repairs: a tap off a fitting, a gap over 3 in, a size or air-type change, a system that should be split or merged. Pe selects the element in Revit; the engineer fixes it.",
  "Which parameter holds the design airflow on this project, and a flow for any grille that has none.",
  "A flow for a side-stream unit (a dehumidifier) whose air does not end at grilles.",
  "A unit's role when the rule guesses wrong (a filter chassis alone in its network reads as a fan).",
  "Whether a modelled loop was intended. It is priced as a tree and flagged.",
  "Which ASHRAE table a fitting rule uses when the family does not name its tested shape.",
  "Approval of each heal and each write. Pea proposes and previews; the engineer writes.",
];

export const DUCTS_LIMITS: readonly string[] = [
  "Grille drops are not included unless entered. Manufacturer tables are out of scope until terminal selections are final, so the ESP leaves the grille out until then.",
  "Rectangular radius elbows have no rule yet. A mitered elbow's orientation is inferred from Revit's Width.",
  "A duct entered from its side connector is charged friction over its whole length. The error is small per duct but there can be many.",
  "Internal equipment drops (coil, filter, ERV core) have no source and are not counted.",
  "A loop drawn in Revit is cut where the walk reaches a joint a second time. The air is not split between the two paths, so those paths read slightly high or low.",
  "Equivalent feet are converted at each duct's own friction rate, so a longer run can lose less pressure than a shorter one. How the critical run is chosen and shown against feet is not yet ruled.",
  "Revit allows one fan per system. A system name spanning two networks with their own air handlers is priced per fan here, but cannot be given one base equipment in Revit until it is split.",
  "Results are not stored. A schedule cannot read the ESP until a result parameter exists.",
  "A link on the tutorial opens a case on the project it was recorded from. On another document the ids will not resolve. Deriving live examples from the open document is planned.",
];

/** The whole guide, for the read and the skill generator. */
export const DUCTS_GUIDE = {
  summary: DUCTS_SUMMARY,
  walk: DUCTS_WALK,
  notOneClick: DUCTS_NOT_ONE_CLICK,
  peaDoes: DUCTS_PEA_DOES,
  peaNever: DUCTS_PEA_NEVER,
  residencyRule: DUCTS_RESIDENCY_RULE,
  residency: DUCTS_RESIDENCY,
  whyNotRevit: DUCTS_WHY_NOT_REVIT,
  whyWriteBack: DUCTS_WHY_WRITE_BACK,
  methodsNote: DUCTS_METHODS_NOTE,
  methods: DUCTS_METHODS,
  naviate: DUCTS_NAVIATE,
  engineerDecides: DUCTS_ENGINEER_DECIDES,
  limits: DUCTS_LIMITS,
  caseGroups: CASE_GROUPS,
  cases: DUCT_CASES,
} as const;
export type DuctsGuide = typeof DUCTS_GUIDE;

/** The cases whose `kinds` include one of the given finding kinds (`kind` or `kind:grade`). */
export const casesForFindings = (
  findings: readonly { kind: string; grade?: string | null }[],
): { case: DuctCase; count: number }[] => {
  const counts = new Map<string, number>();
  for (const f of findings) {
    counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
    if (f.grade) counts.set(`${f.kind}:${f.grade}`, (counts.get(`${f.kind}:${f.grade}`) ?? 0) + 1);
  }
  return DUCT_CASES.flatMap((c) => {
    const count = c.kinds.reduce((sum, k) => sum + (counts.get(k) ?? 0), 0);
    return count ? [{ case: c, count }] : [];
  });
};
