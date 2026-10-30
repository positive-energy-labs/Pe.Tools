import { ductsGraph } from "../../../../apps/web/src/ducts/graph.ts";
import { DUCTS_SHEET_GUIDE, projectRouteGraph } from "@pe/agent-contracts";
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
    "",
    "The Ducts route graph (Work, Page, readings, semantic verbs and ordered stages):",
    "```json",
    JSON.stringify(projectRouteGraph(ductsGraph), null, 2),
    "```",
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
