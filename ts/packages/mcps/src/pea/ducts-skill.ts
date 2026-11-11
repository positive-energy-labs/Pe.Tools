import { DUCTS_SHEET_GUIDE } from "@pe/agent-contracts";
import { z } from "zod";

export function renderDuctsSkill(): string {
  return [
    "---",
    "name: calc-duct-pressure-drop",
    "description: Use for any ductwork airflow question - what a unit (ERV, MUAS, fan coil, AHU) connects or ties into, what it feeds or draws from, which way air flows - and for duct pressure drop, static pressure or required ESP. Reads the fan sheet and explains its path ends, blockers and sourced inputs.",
    "---",
    "",
    "# Calculate Duct Pressure Drop",
    "",
    DUCTS_SHEET_GUIDE.summary,
    "Connectivity and airflow questions (what a unit ties into, where its air goes, whether two units are connected) are answered by this sheet's path ends and legs, which resolve airflow direction from the network. Never answer them from a script over connector Direction or flow-direction flags: those are per-connector labels, not the air's path, and reading them reads the air backwards. Name each unit by its mark or type, and say when a path ends at an open end instead of a unit.",
    "Registered reads use route:reads.value with { read, args, subscription, generation }: put target and sheet selectors in args, choose a unique subscription per consumer and a nonnegative generation, and read the result from value.data.",
    "Sheet and roster reads never edit Work. Stage edits through route:ducts Work verbs at expectedRevision. For duct losses, heal, or assign-fan, send only the document target and work: { key, revision }, the route:ducts Work handle; never send native arrays or coefficients. Before planning duct losses, stage route:fans writeIntent.walk { unitId, portIndex } from route:reads.value (read fans.roster); the plan reads sibling Fans Work at the same document, or readWorks.fans. Fan write cells are derived from the walk and staged edits. The open Page never supplies the walk. Stage writeIntent.groups for heal scope or writeIntent.fan { unitId, systemId } for fan assignment. Preview first; apply re-derives and refuses a changed seal without clearing edits.",
    "Frame an equipment question as what each component on the walked path does to the air, not which number is right. For each component whose number feeds a calc (flow, pressure, capacity, rating, and a value that cannot be wrong, such as a connection size), get that component's own data: the project cut sheet or submittal first, then a schedule, then the vendor's site. Cite the page.",
    "Read schedules and charts with read_document, image: true and a crop. The text layer drops strike-throughs and revision clouds.",
    "When a sheet input is blank and the model or a document has the value, fill it yourself through the Ducts tool's Work with the source cited, then read the sheet again. Do not only offer to.",
    "",
    ...DUCTS_SHEET_GUIDE.walk.map((step, i) => `${i + 1}. ${step}`),
    "",
    ...DUCTS_SHEET_GUIDE.never.map((rule) => `- ${rule}`),
    "",
  ].join("\n");
}

export const ductsGuideInputSchema = z.strictObject({
  section: z.enum(["summary", "walk", "never"]).optional(),
});
export type DuctsGuideSection = keyof typeof DUCTS_SHEET_GUIDE;
export function ductsGuideReading(section?: DuctsGuideSection) {
  return section ? { [section]: DUCTS_SHEET_GUIDE[section] } : DUCTS_SHEET_GUIDE;
}
