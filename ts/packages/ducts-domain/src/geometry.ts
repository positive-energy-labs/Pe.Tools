import type { DuctSnapshot } from "./types.ts";

/** Physical transition inputs, independent of rooted graph traversal. Historical root-relative
 * inlet/area facts and type labels cannot establish these observations. */
export function transitionGeometry(node: DuctSnapshot["nodes"][number]) {
  const ports = node.connectors;
  const pair =
    ports.length === 2 &&
    ports.filter((c) => c.direction === "in").length === 1 &&
    ports.filter((c) => c.direction === "out").length === 1;
  const angles = node.facts.filter((f) => f.key === "angle");
  const observed = angles.length === 1 && angles[0]!.unit === "deg" ? angles[0]!.value : null;
  const angleDeg =
    observed != null && Number.isFinite(observed) && observed > 0 && observed <= 180
      ? observed
      : null;
  return {
    inlet: pair ? ports.find((c) => c.direction === "in") : undefined,
    outlet: pair ? ports.find((c) => c.direction === "out") : undefined,
    angleDeg,
    error: !pair
      ? "transition requires exactly one In and one Out connector"
      : angleDeg == null
        ? "transition has no valid measured included angle in degrees"
        : undefined,
  };
}
