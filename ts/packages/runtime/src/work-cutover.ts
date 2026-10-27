import { isRecord } from "@pe/agent-contracts";

const dictionaries: Record<string, readonly string[]> = {
  family: ["cells"], families: ["cells"], pods: ["fields"], schedules: ["cells"],
  rooms: ["edits", "marks"], takeoffs: ["edits", "adopt", "decisions", "reviewFlags"],
  ducts: ["calculation", "assumptions", "rules", "catalogs", "ruleAssignments", "terminalDrops", "componentDrops", "esp", "equipmentFlows", "roles", "loads", "flows", "parameters", "subject", "claims"],
};
const singletons: Record<string, readonly string[]> = {
  families: ["scope", "patch"], "parameter-links": ["profile"],
  ducts: ["labelParameter", "workingPhase", "designFriction", "systemColours"],
};

/** Only declared Work cell slots convert. User values, source bytes and evidence are opaque. */
export function convertLegacyWork(value: unknown, route: string): unknown {
  if (!isRecord(value) || value.version !== 1 || !Number.isInteger(value.revision) || !isRecord(value.doc))
    throw Error("Historical Work envelope is unreadable; source bytes were retained");
  const doc = structuredClone(value.doc);
  const change = (rung: unknown) => {
    if (rung == null) return rung;
    if (!isRecord(rung) || (!Object.hasOwn(rung, "value") && rung.delete !== true))
      throw Error("Historical change is unreadable; source bytes were retained");
    return { ...rung, by: rung.by === "pea" ? "pea" : rung.by === "person" || rung.by === "human" ? "human" : "unknown", at: typeof rung.at === "string" ? rung.at : null, base: typeof rung.base === "number" ? rung.base : null };
  };
  const cell = (input: unknown) => {
    if (!isRecord(input)) throw Error("Historical cell is unreadable");
    if (("staged" in input && "edit" in input) || ("proposal" in input && "suggestion" in input))
      throw Error("Work contains both old and shared edit slots; conversion needs inspection");
    return Object.fromEntries(Object.entries(input).map(([key, child]) => key === "staged" || key === "proposal" ? [key === "staged" ? "edit" : "suggestion", change(child)] : [key, child]));
  };
  for (const key of dictionaries[route] ?? []) {
    const values = doc[key];
    if (values === undefined) continue;
    if (!isRecord(values)) throw Error(`Historical ${key} cells are unreadable`);
    doc[key] = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, cell(value)]));
  }
  for (const key of singletons[route] ?? []) if (doc[key] != null) doc[key] = cell(doc[key]);
  if (route === "families" && isRecord(doc.excluded)) doc.excluded = Object.fromEntries(Object.entries(doc.excluded).map(([name, exclusion]) => [name, isRecord(exclusion) ? {...exclusion,by:exclusion.by === "person" ? "human" : exclusion.by === "pea" ? "pea" : "unknown"} : exclusion]));
  return { ...value, doc };
}
