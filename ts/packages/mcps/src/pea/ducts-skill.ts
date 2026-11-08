import { DUCTS_SHEET_GUIDE } from "@pe/agent-contracts";
import { z } from "zod";

export function renderDuctsSkill(): string {
  return [
    "---",
    "name: calc-duct-pressure-drop",
    "description: Read a per-fan sheet for duct pressure drop, pdrop, static pressure or required ESP and explain its blockers and sourced inputs.",
    "---",
    "",
    "# Calculate Duct Pressure Drop",
    "",
    DUCTS_SHEET_GUIDE.summary,
    "Registered reads use route:reads.value with { read, args, subscription, generation }: put target and sheet selectors in args, choose a unique subscription per consumer and a nonnegative generation, and read the result from value.data.",
    "Sheet and roster reads never edit Work. Stage edits through route:ducts Work verbs at expectedRevision. For duct losses, heal, or assign-fan, send only the document target and work: { key, revision }, the route:ducts Work handle; never send native arrays or coefficients. Before planning duct losses, stage route:fans writeIntent.walk { unitId, portIndex } from route:reads.value (read fans.roster); the plan reads sibling Fans Work at the same document, or readWorks.fans. Fan write cells are derived from the walk and staged edits. The open Page never supplies the walk. Stage writeIntent.groups for heal scope or writeIntent.fan { unitId, systemId } for fan assignment. Preview first; apply re-derives and refuses a changed seal without clearing edits.",
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
