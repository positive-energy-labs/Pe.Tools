/**
 * The one source for what the ducts product does, written once and projected three ways: the
 * `/ducts` tutorial renders it for people, Pea's bundled `calc-duct-pressure-drop` skill is
 * generated from it, and the `route:ducts.guide` read returns it with the cases present in a
 * document. A line belongs here when it changes with the product and everyone needs it. Which
 * capability Pea calls at each step is operational and lives beside the capabilities; why a
 * ruling was made lives in `docs/features/ducts/LEDGER.md`.
 *
 * Register: plain third person for any engineer or reviewer. "The engineer" is the person using
 * the tool, "Pea" the agent, "the tool" the Ducts page. "Route" is a code word and never appears in this prose. No second person. Element ids and system names appear only in a case's recorded example.
 */
import { CASE_GROUPS, DUCT_CASES, type CaseGroup, type DuctCase } from "./ducts-cases.ts";
import { DUCTS_COMPARE } from "./ducts-compare.ts";

export { CASE_GROUPS, DUCT_CASES };
export { DUCTS_COMPARE, onPeRoadmap } from "./ducts-compare.ts";
export type { DuctsCompareCell, DuctsCompareRow, DuctsProduct } from "./ducts-compare.ts";
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

export const DUCTS_SUMMARY =
  "The Ducts tool reads every duct network in the document from Revit's connectors, repairs what it safely can, prices each grille's path from its fan, and writes the inputs it used back into the model so they travel with it. The result is a design-grade number with its assumptions listed. It is not a certification. The engineer sees the number per grille and what it rests on, Pea proposes and previews, and the engineer rules on anything the model cannot settle.";

export const DUCTS_WALK: readonly DuctsWalkStep[] = [
  {
    step: "Name the system",
    who: "Engineer or Pea",
    body: "Pick a Revit duct system by its name. The tool shows every duct network that system touches, one section per fan, and marks any network shared with other systems. The search box moves within the same read: an element id, an equipment tag, or another system.",
  },
  {
    step: "Heal the model",
    who: "The tool proposes, engineer approves, Pea or engineer applies",
    body: "Pe builds the network from Revit's connectors, not from the system name. Gaps under about 2 in and near-miss taps are bridged for the calculation and listed as diagnostics. Dangling ends get a cap, touching ends get connected, and small same-size gaps get a union. These are written into Revit after a preview. Anything harder appears as a Fix row that names the repair and selects the element in Revit.",
  },
  {
    step: "Point at the airflow",
    who: "Engineer",
    body: "Choose which parameter holds each grille's design airflow on this project (a firm parameter, the family's own Flow, or whatever the drafter used). The tool lists every grille's value and its source. A grille with no value becomes a Set row. A fan's flow is the sum of its grilles. Only a side-stream unit such as a dehumidifier needs a typed flow.",
  },
  {
    step: "Price",
    who: "The tool",
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

/** What Pea does in the tool, as object rights. */
export const DUCTS_PEA_DOES: readonly string[] = [
  "Opens the tool on the system the engineer names, or moves it there.",
  "Reads every fact and finding the tool shows, including Diagnostics.",
  "Proposes a value on any cell and any blocking row, with its evidence in the note.",
  "Presses survey, previews heals, and applies a heal once the engineer approves it.",
  "Previews making a unit the fan of its system, and shows the outcome.",
  "Walks the inbox in order, Fix, Set, Check, Write, and reports in the tool's words: system, finding, required ESP now and staged.",
];

/** What Pea never does in the tool. */
export const DUCTS_PEA_NEVER: readonly string[] = [
  "Stages a ruling or an airflow slot; typing is the engineer's decision.",
  "Writes an ESP or presses the loss write.",
  "Applies the fan assignment; it previews and the engineer presses it.",
  "Computes a pressure drop of its own, by script or by hand; the tool's number is the number.",
  "Edits geometry by script; transitions, takeoffs, long gaps and anything joining two systems are the engineer's, in Revit.",
];

export const DUCTS_RESIDENCY: readonly DuctsResidency[] = [
  {
    value: "Computed losses, critical path, ESP",
    livesIn: "Nowhere. Recomputed on every read.",
    survivesSave: "No",
    whoSees: "Anyone with Pe sees the same number from the same model",
    whoWrites: "The tool",
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
    value: "Design friction rate (changes only the feet shown, never a pressure or the ESP)",
    livesIn: "Tool settings (the duct settings popover)",
    survivesSave: "Yes, in local settings",
    whoSees: "Only this computer",
    whoWrites: "The engineer",
  },
];

export const DUCTS_RESIDENCY_RULE =
  "Anything that affects the pressure is stored in the model, so another person or another tool sees the same thing. The only state Pe keeps for itself is what has been typed and not yet written.";

/** What an engineer has to decide; the tool cannot settle these from the model alone. */
export const DUCTS_ENGINEER_DECIDES: readonly string[] = [
  "Anomalous joins: a reversed connector, a part pushed through a duct, supply meeting return. The tool objects and waits for a ruling.",
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
  "Equivalent feet are converted at each duct's own friction rate, so a longer run can lose less pressure than a shorter one. The critical run is chosen by pressure, so the run with the most feet is not always the critical one. Showing feet as pressure divided by the design rate, which would keep the two in the same order, is owed.",
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
  compare: DUCTS_COMPARE,
  engineerDecides: DUCTS_ENGINEER_DECIDES,
  limits: DUCTS_LIMITS,
  caseGroups: CASE_GROUPS,
  cases: DUCT_CASES,
} as const;
export type DuctsGuide = typeof DUCTS_GUIDE;

/**
 * The cases whose `kinds` are counted in `counts`, the analysis's `findingCounts.byKindAndGrade`
 * (keys `kind` or `kind:grade`). A case naming an ungraded kind counts every grade of it.
 */
export const casesForCounts = (
  counts: Readonly<Record<string, number>>,
): { case: DuctCase; count: number }[] =>
  DUCT_CASES.flatMap((c) => {
    const count = c.kinds.reduce(
      (sum, k) =>
        sum +
        (k.includes(":")
          ? (counts[k] ?? 0)
          : Object.entries(counts).reduce(
              (n, [key, v]) => (key === k || key.startsWith(`${k}:`) ? n + v : n),
              0,
            )),
      0,
    );
    return count ? [{ case: c, count }] : [];
  });

/** `casesForCounts` over a findings list, for callers that hold the list rather than the counts. */
export const casesForFindings = (
  findings: readonly { kind: string; grade?: string | null }[],
): { case: DuctCase; count: number }[] => {
  const counts: Record<string, number> = {};
  for (const f of findings) {
    const key = f.grade ? `${f.kind}:${f.grade}` : f.kind;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return casesForCounts(counts);
};
