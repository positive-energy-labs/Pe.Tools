import {
  applyPatch,
  isRecord,
  routeDocDelta,
  sameValue,
  type RouteStatePatch,
} from "@pe/agent-contracts";

const dictionaries: Record<string, readonly string[]> = {
  family: ["cells"],
  families: ["cells"],
  pods: ["fields"],
  schedules: ["cells"],
  rooms: ["edits", "marks"],
  takeoffs: ["edits", "adopt", "decisions", "reviewFlags"],
  ducts: [
    "calculation",
    "assumptions",
    "rules",
    "catalogs",
    "ruleAssignments",
    "terminalDrops",
    "componentDrops",
    "esp",
    "equipmentFlows",
    "roles",
    "loads",
    "flows",
    "parameters",
    "subject",
    "claims",
  ],
};
const singletons: Record<string, readonly string[]> = {
  families: ["scope", "patch"],
  "parameter-links": ["profile"],
  ducts: ["labelParameter", "workingPhase", "designFriction", "systemColours"],
};

/** Only declared Work cell slots convert. User values, source bytes and evidence are opaque. */
export function convertLegacyWork(value: unknown, route: string): unknown {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Number.isInteger(value.revision) ||
    !isRecord(value.doc)
  )
    throw Error("Historical Work envelope is unreadable; source bytes were retained");
  const doc = structuredClone(value.doc);
  const change = (rung: unknown) => {
    if (rung == null) return rung;
    if (!isRecord(rung) || (!Object.hasOwn(rung, "value") && rung.delete !== true))
      throw Error("Historical change is unreadable; source bytes were retained");
    return {
      ...rung,
      by:
        rung.by === "pea"
          ? "pea"
          : rung.by === "person" || rung.by === "human"
            ? "human"
            : "unknown",
      at: typeof rung.at === "string" ? rung.at : null,
      base: typeof rung.base === "number" ? rung.base : null,
    };
  };
  const cell = (input: unknown) => {
    if (!isRecord(input)) throw Error("Historical cell is unreadable");
    if (("staged" in input && "edit" in input) || ("proposal" in input && "suggestion" in input))
      throw Error("Work contains both old and shared edit slots; conversion needs inspection");
    return Object.fromEntries(
      Object.entries(input).map(([key, child]) =>
        key === "staged" || key === "proposal"
          ? [key === "staged" ? "edit" : "suggestion", change(child)]
          : [key, child],
      ),
    );
  };
  for (const key of dictionaries[route] ?? []) {
    const values = doc[key];
    if (values === undefined) continue;
    if (!isRecord(values)) throw Error(`Historical ${key} cells are unreadable`);
    doc[key] = Object.fromEntries(Object.entries(values).map(([id, value]) => [id, cell(value)]));
  }
  for (const key of singletons[route] ?? []) if (doc[key] != null) doc[key] = cell(doc[key]);
  if (route === "families" && isRecord(doc.excluded))
    doc.excluded = Object.fromEntries(
      Object.entries(doc.excluded).map(([name, exclusion]) => [
        name,
        isRecord(exclusion)
          ? {
              ...exclusion,
              by: exclusion.by === "person" ? "human" : exclusion.by === "pea" ? "pea" : "unknown",
            }
          : exclusion,
      ]),
    );
  return { ...value, doc };
}

/** A counter-proposal the suggestion-lane retirement dropped: the one named loss (ADR 0030 rule 8). */
export interface DroppedSuggestion {
  path: (string | number)[];
  suggestion: unknown;
  edit: unknown;
}

/** A retired two-lane cell: an object holding `suggestion` and nothing but `suggestion`/`edit`. */
const twoLane = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) &&
  Object.hasOwn(value, "suggestion") &&
  Object.keys(value).every((key) => key === "suggestion" || key === "edit");

/**
 * One staged value per cell, applied to any JSON value. Edit wins when both are set; a suggestion
 * alone becomes the staged edit with its author kept; a differing suggestion beside an edit is
 * dropped and reported.
 */
function collapseValue(
  value: unknown,
  dropped: DroppedSuggestion[],
  path: (string | number)[] = [],
): unknown {
  if (twoLane(value)) {
    const { suggestion, edit } = value as { suggestion?: unknown; edit?: unknown };
    if (edit != null && suggestion != null && !sameValue(suggestion as never, edit as never))
      dropped.push({ path, suggestion, edit });
    const next = edit ?? suggestion;
    return next === undefined ? {} : { edit: next };
  }
  if (Array.isArray(value)) return value.map((item, index) => collapseValue(item, dropped, [...path, index]));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, collapseValue(child, dropped, [...path, key])]),
    );
  return value;
}

/**
 * The storage boundary of the suggestion-lane retirement, run on every raw Work read before parse.
 * The doc collapses, and so does every history step: its preimage is rebuilt from `after` and the
 * stored inverse, both sides collapse, and patches and inverse are re-derived, so an undo of a step
 * written before the retirement restores a value the current schema accepts. Null when nothing held
 * a suggestion, so callers persist only a real change.
 */
export function retireSuggestionLane(
  raw: unknown,
): { value: unknown; dropped: DroppedSuggestion[] } | null {
  if (!isRecord(raw) || !JSON.stringify(raw).includes('"suggestion"')) return null;
  const dropped: DroppedSuggestion[] = [];
  const value: Record<string, unknown> = { ...raw, doc: collapseValue(raw.doc, dropped, ["doc"]) };
  if (Array.isArray(raw.history))
    value.history = raw.history.map((record: unknown) => {
      if (!isRecord(record) || !isRecord(record.write) || !Object.hasOwn(record, "after")) return record;
      const write = record.write as { patches?: RouteStatePatch[]; inverse?: RouteStatePatch[] };
      const holder = { doc: structuredClone(record.after) };
      for (const patch of write.inverse ?? [])
        applyPatch(holder, { ...patch, path: ["doc", ...patch.path] });
      const keyed = (write.patches ?? [])
        .filter((patch) => patch.path.length > 1)
        .map((patch) => String(patch.path[0]));
      // History counter-proposals are not reported: only the current doc's are live data.
      const before = collapseValue(holder.doc, []);
      const after = collapseValue(record.after, []);
      return {
        ...record,
        ...(isRecord(record.recovery)
          ? { recovery: { ...record.recovery, doc: collapseValue(record.recovery.doc, []) } }
          : {}),
        after,
        write: {
          ...record.write,
          patches: routeDocDelta(before, after, [], keyed),
          inverse: routeDocDelta(after, before, [], keyed),
        },
      };
    });
  if (JSON.stringify(value) === JSON.stringify(raw)) return null;
  return { value, dropped };
}
