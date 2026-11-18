import type { DuctAirType } from "@pe/agent-contracts";
import type { DuctSnapshot } from "./types.ts";

const normalized = (s: string) => s.toLowerCase().replace(/[\s_-]/g, "");
const classificationType = (s: string): DuctAirType | null => {
  switch (normalized(s)) {
    case "supplyair":
      return "supply";
    case "returnair":
      return "return";
    case "exhaustair":
      return "exhaust";
    default:
      return null;
  }
};
const prefixType = (s: string): DuctAirType | null => {
  const prefix = /^(SA|RA|FA|EX|FL)(?=$|[\s_\d-])/i.exec(s.trim())?.[1]?.toUpperCase();
  return prefix === "SA"
    ? "supply"
    : prefix === "RA"
      ? "return"
      : prefix === "FA"
        ? "fresh"
        : prefix === "EX" || prefix === "FL"
          ? "exhaust"
          : null;
};

/** MechanicalSystem classification first. Revit classifies FA and SA alike; only FA needs a name refinement. */
export function airTypesOf(snapshot: DuctSnapshot): ReadonlyMap<number, DuctAirType> {
  const systems = new Map<string, string[]>();
  for (const s of snapshot.systems)
    systems.set(s.name, [...(systems.get(s.name) ?? []), s.classification]);
  return new Map(
    [...snapshot.nodes, ...snapshot.segments].map((element) => {
      const names = (element.systemName ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const reported = names.flatMap((name) => systems.get(name) ?? []);
      const classes = reported.length ? reported : (element.classification ?? "").split(",");
      const known = [...new Set(classes.flatMap((c) => classificationType(c) ?? []))];
      const prefixes = [...new Set(names.flatMap((name) => prefixType(name) ?? []))];
      let type: DuctAirType = "unknown";
      if (known.length === 1) {
        type = known[0]!;
        if (type === "supply" && prefixes.includes("fresh"))
          type = prefixes.includes("supply") ? "unknown" : "fresh";
      } else if (!known.length && prefixes.length === 1) type = prefixes[0]!;
      return [element.id, type];
    }),
  );
}
