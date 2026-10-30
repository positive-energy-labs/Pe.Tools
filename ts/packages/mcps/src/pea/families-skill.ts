import { projectRouteGraph } from "@pe/agent-contracts";
import { familiesGraph } from "../../../../apps/web/src/families/graph.ts";

export function renderFamiliesSkill(): string {
  return [
    "---",
    "name: edit-loaded-families",
    "description: Read loaded families, propose keyed type values, review a sealed Family Foundry plan, and inspect its receipts.",
    "---",
    "",
    "# Edit loaded families",
    "",
    "Families Work belongs to an exact project document. Read its revision before proposing scope, native patch bytes, keyed cells or exclusions. Cell keys are [familyName,typeName,parameter], never element ids.",
    "families.read captures the drafted scope. Picker changes do not read Revit. Only a complete reading can arm edits or planning. Retired attempts cannot publish parts or completion after leaving their Target or Work, even on A→B→A.",
    "A person's table-cell edit is one journal step. Mod+Z restores that exact edit. Use the graph's cell verbs to take, reject, reopen or delete proposals. Keep native patch edits and per-type edits mutually exclusive.",
    "Apply families shows the exact families.plan preview and commits its sealed plan id through families.apply. Work changes make the review stale. Results and receipts are readings, never Page or authored Work. History is read-only.",
    "Start fresh sets unreadable Work aside. Carry over reviews the missing scope and named exclusions, then applies them as one undoable Work write. Both are kernel recovery verbs.",
    "",
    "The Families route graph:",
    "```json",
    JSON.stringify(projectRouteGraph(familiesGraph), null, 2),
    "```",
    "",
  ].join("\n");
}
