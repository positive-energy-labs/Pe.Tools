import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { connOf, ductOf, factOf, groupOf, nodeOf, round, slots, snapshotOf, uniqueIdOf } from "@pe/ducts-domain/test-snapshot";
import { TEST_WALK } from "@pe/fans-domain/calc/test-inputs";

export const CLOSED_AT = "2026-11-16T00:00:00Z";
/** The recorded loss tables, as the native `ducts.tables` read answers them. */
// A path, not a URL object: under jsdom the global URL is not the one node:fs accepts.
export const recordedTables = () => JSON.parse(readFileSync(fileURLToPath(import.meta.resolve("@pe/ducts-host/tests/native-recordings/driver-ducts.tables.json")), "utf8"));

/**
 * Fixture data, not a native observation: one closed fan (a supply duct, elbow and terminal, and a
 * return duct and terminal), so its calc is complete. `unit` is the fan and every other id is offset
 * from it (unit 100 walks 1..5). `cohort` is the units sharing its required ESP parameter: one unit is
 * an instance cohort, more is a type cohort. `supplyFt` changes the required ESP between peers.
 */
export function closedFan(unit: number, o: { cohort?: readonly number[]; requiredEsp?: string; supplyFt?: number } = {}) {
  const at = (n: number) => unit - 100 + n;
  const members = o.cohort ?? [unit], parameter = o.requiredEsp ?? "ESP";
  const port = (index: number, to: [number, number], classification: string) => connOf(index, to, { ...round(12), classification });
  const terminal = (id: number, to: [number, number], classification: string) =>
    nodeOf(id, "terminal", {
      groupId: classification === "ReturnAir" ? "r" : "g", family: "terminal", flowParameter: "revit:Flow",
      connectors: [{ ...port(0, to, classification), flowCfm: 200 }], facts: [factOf("flow", 200)],
    });
  const duct = (id: number, groupId: string, lengthFt: number, a: [number, number], b: [number, number], classification: string) =>
    ductOf(id, { ...round(12), groupId, lengthFt, polyline: [[0, 0, 0], [lengthFt, 0, 0]], connectors: [port(0, a, classification), port(1, b, classification)] });
  return snapshotOf({
    parameterCohorts: [{
      parameter, owner: members.length > 1 ? { kind: "type", id: 77 } : { kind: "instance", id: unit },
      members: members.map((id) => ({ elementId: id, uniqueId: uniqueIdOf(id) })), complete: true, basis: CLOSED_AT,
    }],
    walk: { ...TEST_WALK, startId: unit },
    document: { title: "closed synthetic", readAt: CLOSED_AT, elapsedMs: 0, networkBasedCalculations: false },
    slots: { ...slots, terminalFlow: "revit:Flow", requiredEsp: parameter },
    groups: [
      groupOf("g", { rootIds: [unit], terminalCount: 1, elementCount: 3 }),
      groupOf("r", { rootIds: [unit], terminalCount: 1, elementCount: 2 }),
    ],
    nodes: [
      nodeOf(unit, "equipment", {
        family: "Air Handler", flowParameter: "Fan Flow",
        connectors: [{ ...port(0, [at(1), 0], "SupplyAir"), direction: "out" }, { ...port(1, [at(4), 0], "ReturnAir"), direction: "in" }],
      }),
      nodeOf(at(2), "fitting", {
        groupId: "g", partType: "Elbow", family: "Round Elbow",
        connectors: [port(0, [at(1), 1], "SupplyAir"), port(1, [at(3), 0], "SupplyAir")], facts: [factOf("rOverD", 1)],
      }),
      terminal(at(3), [at(2), 1], "SupplyAir"),
      terminal(at(5), [at(4), 1], "ReturnAir"),
    ],
    segments: [
      duct(at(1), "g", o.supplyFt ?? 10, [unit, 0], [at(2), 0], "SupplyAir"),
      duct(at(4), "r", 10, [unit, 1], [at(5), 0], "ReturnAir"),
    ],
  });
}
