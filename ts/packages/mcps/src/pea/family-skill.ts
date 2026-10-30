import familyGraph from "./generated/family-graph.json" with { type: "json" };

export function renderFamilySkill(): string {
  return [
    "---",
    "name: edit-family",
    "description: Edit one Family Foundry draft, review its sealed apply plan, and inspect original receipts.",
    "---",
    "",
    "# Edit one family",
    "",
    "Family Work belongs to the exact family document. A selected Pod member supplies input; it does not select another Work. Read the current Work revision before changing cells keyed by JSON pointer.",
    "Use the graph's cell verbs to take, reject, reopen or delete a proposal. One human Work edit is one journal step. Mod+Z restores the exact prior Work.",
    "Apply family shows family.plan evidence, then family.apply receives that sealed plan id. A changed Work revision, Page epoch or profile reading refuses the old review. Build .rfa reviews and builds the exact saved member hash, and refuses while unsaved edits remain.",
    "family.saved inspects an immutable reading at its explicit row. Queries have no undo barrier. Saving a family to a Pod is family.capture, a semantic command. family.read is the live read: an explicit press at the Family row that publishes a fresh reading without touching edits or proposals; empty Work never reads on arrival.",
    "Start fresh is the kernel's required recovery review. Receipts, query results and review tickets belong to the kernel; Page holds view state only.",
    "",
    "The Family route graph:",
    "```json",
    JSON.stringify(familyGraph, null, 2),
    "```",
    "",
  ].join("\n");
}
