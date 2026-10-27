import {
  casesForCounts,
  documentRefSchema,
  DUCTS_ANALYSIS_FIRST_CALL,
  DUCTS_GUIDE,
  type DuctsGuide,
} from "@pe/agent-contracts";
import { z } from "zod";

/**
 * Pea's bundled `calc-duct-pressure-drop` skill, projected from `DUCTS_GUIDE` so the tutorial, the
 * skill and `route:ducts.guide` say the same thing. Only the operational tail (which capability to
 * call at each step, and what never to call) is written here: it changes with the capabilities,
 * not with the product.
 */

// A plain YAML scalar: no colon-space anywhere, so never `: "` (gray-matter drops the skill silently).
const DUCTS_SKILL_DESCRIPTION =
  "Answer anything about the Pe Ducts tool and duct pressure drop from the tool itself. Use for pressure drop, pdrop, static pressure, ESP or external static, duct losses, the Ducts tool or /ducts page, the airflow slot, healing open ends or caps on ducts, making a unit the fan of its system, Revit's own pressure drop or critical path, how Pe differs from Manual D, RHVAC or Naviate, where a duct value lives or what survives a save, what Pea can do on ducts, or whether a run is ready, e.g. SA 19 or FC-23.";

const OPERATIONS = String.raw`The Ducts tool computes this. Never rebuild it with pod or C# scripts; they will not match the tool the person reads.

To the person it is the Ducts tool. Route, plugin, workspace, Work key and every capability key (route:ducts.*, op:ducts.*) are your inputs, never words for them; name what they see: the Ducts tool, its groups (Fix, Set, Check, Write), its rows and its buttons.

1. Name the system. The Ducts tool is picked and read by Revit system (SA 19), never by group id: a system can span several duct networks and the tool shows every one, each named by the system and its fan (SA 19 · FC-17, SA 19 · no fan); a network that also carries other systems is marked shared and shown whole. Only the runs that price the named system (fan to its terminals, and its own open ends) block it; the rest of a shared network is Diagnostics. pe_read route:ducts.view for the system names. If the person named systems, pe_do route:ducts.set-view with { system } in their words, comma separated (SA 19,RA 1), to open them side by side, only the ones they named; the last named is the one the write, heal and fan verbs act on. Talk to the person in system and unit names; group ids below are tool inputs, never words for them.
2. Give the system its fan. A unit is proposed the fan first because it is the base equipment of its Revit system. When a unit's role is fan but no system names it base equipment, or a no-fan network has exactly one unit, propose making it the named system's fan (Revit's Duct Systems > Select Equipment): pe_do op:ducts.preview-assign-fan ({ systemId, unitId }: the named system's id from ducts.snapshot systems[].id and the unit's id) runs Pe's guards and the write in Revit and rolls it back; a system with base equipment already, or a unit whose port of that air class is not in the system or on its ducts, is refused, and the refusal says why. Show the person the outcome; apply it when the user authorized that change; the host owns run consent. The person presses "make FC-17 the fan of SA 19" on the unit in the Inputs pane or on the no-fan row; after it the role reason reads "base equipment of SA 19".
3. Heal the model. Open ends and near joins are fixed in Revit, not ruled on: caps on dangling ends, coincident same-size ends connected, same-size gaps of at most 3 in closed. pe_do op:ducts.preview-heal with the group ids ({ groups: [{ group }] }; the host plans each group's items with the tool's own classifier). It runs every repair and Pe's own check in Revit and rolls it all back. Report each group's planned or refused outcomes and reasons. When the requested work authorizes healing, pe_do op:ducts.apply-heal with exactly the items the preview returned as planned; the host owns run consent. Revit gives rebuilt elements new ids, so read again before the next step. Transitions, takeoffs, long gaps and anything joining two systems need separate intent and domain support: name them, never substitute an improvised script. The Ducts tool's Fix group shows the same as one Heal row per group with preview and heal.
4. Point at the airflow. Every terminal's design airflow is read from one parameter, the airflow slot, and projects keep it wherever the drafter put it (a family's own Flow, a shared Actual Supply Air Flow, the connector flow); a wrong slot leaves every grille without a flow. pe_read route:ducts.analysis with input ${DUCTS_ANALYSIS_FIRST_CALL} (source and selector are objects, never strings; session and openId are the open document's): its airflow field names the slot read now and every candidate parameter with how many terminals hold a value (have of N; the built-in Flow is the connector's own flow). Show the person the candidates with their coverage, propose the best-covered one as a claim (route:ducts.edit, claims: text naming the parameter and its coverage, state assumed, ids the terminals it covers), and let the person pick it in the Set group's Airflow from row. Set the shared edit when the requested intent and observed coverage justify the choice; otherwise leave an optional suggestion. Terminal rows' flowSource then reads revit:<slot>.
5. Walk that route:ducts.analysis inbox in order Fix, Set, Check, Write. A finding of kind unreadable-work names saved cells this version cannot read; pricing omitted those cells and kept the rest. Re-enter the intended values in shared Work with its expected revision. Start fresh preserves the complete original aside and starts empty Work; either author can use this recovery, but retaining readable work is preferable. Thread targets supply Pea's context and defaults only. Use the tool's exact Work and per-call document target; changing conversations does not grant, revoke or redirect that Work.
6. Match equipment by its tag: each row's tag is the firm tag parameter PE_G___TagInstance (not the built-in Mark), so "FC-23" is a row tag.
7. Edit shared Work with route:ducts.edit (see skill:@product/skills/propose-changes): flows, esp, equipmentFlows, roles, catalogs, and rulings with evidence in the note. Optional suggestions are review content for either author. Both human and Pea use the same typed write commands when the requested intent authorizes them; the host applies schema, freshness and root-run consent checks. A written ruling (an ignored open end, an objected join, a passive unit) lives in the model's store for everyone on that model; replace it only with supporting evidence and the expected Work revision.
8. Link the exact Ducts Work for review and name the relevant verb: preview lists proposed changes by element, parameter or ruling, old to new; write applies them. Report in the tool's words: system, finding, and required ESP now versus edited; after a heal, the system's ESP before and after.`;

const bare = (text: string) => text.replace(/\.$/, "");
/** A comparison cell with its evidence, so the skill carries what the tutorial shows on hover. */
const cell = (c: { note: string; detail?: string }) =>
  c.detail ? `${bare(c.note)} (${bare(c.detail)})` : bare(c.note);
const bullets = (items: readonly string[]) => items.map((item) => `- ${item}`).join("\n");

/** The skill markdown, frontmatter included. Pure over the guide it is given. */
export function renderDuctsSkill(guide: DuctsGuide = DUCTS_GUIDE): string {
  return [
    "---",
    "name: calc-duct-pressure-drop",
    `description: ${DUCTS_SKILL_DESCRIPTION}`,
    "---",
    "",
    "# Calculate Duct Pressure Drop",
    "",
    guide.summary,
    "",
    "## The walk",
    "",
    guide.walk.map((s, i) => `${i + 1}. ${s.step} (${s.who}). ${s.body}`).join("\n"),
    "",
    "## Not one click",
    "",
    guide.notOneClick,
    "",
    "Pea does:",
    "",
    bullets(guide.peaDoes),
    "",
    "Pea never:",
    "",
    bullets(guide.peaNever),
    "",
    "## Where every value lives",
    "",
    guide.residencyRule,
    "",
    bullets(
      guide.residency.map(
        (r) =>
          `${bare(r.value)}. Lives in: ${bare(r.livesIn)}. Survives a save: ${bare(r.survivesSave)}. Who sees: ${bare(r.whoSees)}. Who writes: ${bare(r.whoWrites)}.`,
      ),
    ),
    "",
    "## Against Revit and Naviate",
    "",
    bullets(
      guide.compare.flatMap(({ rows }) =>
        rows.map(
          (r) =>
            `${r.feature}. Revit: ${cell(r.revit)}. Naviate: ${cell(r.naviate)}. Pe: ${cell(r.pe)}.`,
        ),
      ),
    ),
    "",
    "The evidence behind each cell is pe_read route:ducts.guide with section compare.",
    "",
    "## The engineer decides",
    "",
    bullets(guide.engineerDecides),
    "",
    "## Limits",
    "",
    bullets(guide.limits),
    "",
    "## Cases",
    "",
    `The route handles ${guide.cases.length} known model cases. Which of them are present in the open document, with element ids, comes from pe_read route:ducts.guide with that document; pass section cases for each case's full prose.`,
    "",
    "## Driving the tool",
    "",
    OPERATIONS,
    "",
  ].join("\n");
}

/** `route:ducts.guide` input: the guide alone, one section of it, or the cases present in a document. */
export const ductsGuideInputSchema = z.strictObject({
  document: documentRefSchema
    .optional()
    .describe("An exact open document: adds `present`, the cases its fresh ducts analysis shows."),
  section: z
    .enum(Object.keys(DUCTS_GUIDE) as [DuctsGuideSection, ...DuctsGuideSection[]])
    .optional()
    .describe("One top-level key of the guide; `cases` returns every case with its prose."),
});
export type DuctsGuideSection = keyof DuctsGuide;

/** The guide as the read returns it: cases cut to their identity unless `cases` was asked for. */
export function ductsGuideReading(
  section?: DuctsGuideSection,
): Partial<Record<DuctsGuideSection, unknown>> {
  if (section) return { [section]: DUCTS_GUIDE[section] };
  const cases = DUCTS_GUIDE.cases.map(({ number, group, title, code, status, kinds }) => ({
    number,
    group,
    title,
    code,
    status,
    kinds,
  }));
  return { ...DUCTS_GUIDE, cases };
}

/**
 * The cases a document shows: counts from `findingCounts.byKindAndGrade` (never budgeted), and up
 * to ten element ids per case from whatever findings the reading kept.
 */
export function presentDuctCases(
  counts: Readonly<Record<string, number>>,
  findings: readonly { kind: string; grade?: string | null; elementIds: readonly number[] }[],
) {
  return casesForCounts(counts).map(({ case: c, count }) => {
    const elementIds = [
      ...new Set(
        findings
          .filter(
            (f) =>
              c.kinds.includes(f.kind) || (f.grade && c.kinds.includes(`${f.kind}:${f.grade}`)),
          )
          .flatMap((f) => f.elementIds),
      ),
    ].slice(0, 10);
    return {
      number: c.number,
      title: c.title,
      code: c.code,
      count,
      ...(elementIds.length ? { elementIds } : {}),
    };
  });
}
