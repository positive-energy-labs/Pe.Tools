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
    "Stage a cell by writing its edit; use the graph's cell verbs to clear or delete one. One human Work edit is one Timeline step. Mod+Z undoes the person's own last step, never Pea's.",
    "Apply family shows family.plan evidence, then family.apply receives that sealed plan id. A changed Work revision, Page epoch or profile reading refuses the old review. Build .rfa reviews and builds the exact saved member hash, and refuses while unsaved edits remain.",
    "family.saved inspects an immutable reading at its explicit row. Queries have no undo barrier. Saving a family to a Pod is family.capture, a semantic command: it takes only the Work handle and reads its pod from the writeIntent cell 'family.capture' in Family Work, files the family under settings/family/, and returns the member. family.attach-spec attaches a cut sheet to that member from a path, a URL or an upload. family.read is the live read: an explicit press at the Family row that publishes a fresh reading without touching staged edits; empty Work never reads on arrival.",
    "Start fresh is the kernel's required recovery review. Receipts, query results and review tickets belong to the kernel; Page holds view state only.",
    "",
    "Read route:family with pe_read for its current graph, field schemas and verb inputs from the host.",
    "",
  ].join("\n");
}
