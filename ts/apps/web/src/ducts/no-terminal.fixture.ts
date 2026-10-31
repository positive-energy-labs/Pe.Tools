import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { snapshot } from "./test-fixture";

/** EX 1's failing shape: a fan discharges through a duct's open end, with no terminal path. */
export function noTerminalSnapshot(): DuctSnapshot {
  const raw = structuredClone(snapshot);
  const fan = raw.nodes.find((node) => node.id === 100)!;
  const duct = raw.segments[0]!;
  return {
    ...raw,
    groups: [{ ...raw.groups[0]!, systemNames: ["EX 1"], terminalCount: 0, elementCount: 1 }],
    nodes: [
      {
        ...fan,
        connectors: [{ ...fan.connectors[0]!, connectedTo: { elementId: 11620957, connector: 0 } }],
      },
    ],
    segments: [
      {
        ...duct,
        id: 11620957,
        systemName: "EX 1",
        connectors: [
          { ...duct.connectors[0]!, connectedTo: { elementId: 100, connector: 0 } },
          { ...duct.connectors[1]!, point: [10, 0, 0], connectedTo: null, flowCfm: 444 },
        ],
      },
    ],
    systems: [{ ...raw.systems[0]!, name: "EX 1", baseEquipmentId: 100, criticalPath: [] }],
  };
}
