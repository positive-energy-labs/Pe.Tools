/** Test support: the six-element slice and the saved synthetic snapshot, both typed with no cast. */
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import {
  connOf,
  ductOf,
  factOf,
  groupOf,
  nodeOf,
  snapshotOf,
  systemOf,
} from "@pe/ducts-domain/test-snapshot";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import saved from "./fixtures/synthetic-snapshot.json";

/** A fresh copy of the saved synthetic snapshot, decoded by the wire schema the page itself uses. */
export const syntheticSnapshot = (): DuctSnapshot =>
  nativeResponseSchema("ducts.snapshot.walk").parse(structuredClone(saved));

const links = [
  [100, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [2, 5],
  [5, 6],
];
const connectors = (id: number) =>
  links
    .filter((pair) => pair.includes(id))
    .map((pair, index) =>
      connOf(index, [pair.find((other) => other !== id)!, 0], {
        point: [id, 0, 0],
        direction: "out",
        size: "8 in",
        classification: "Supply Air",
      }),
    );
export const snapshot = snapshotOf({
  document: {
    networkBasedCalculations: false,
    title: "slice",
    readAt: "2026-10-21T00:00:00Z",
    elapsedMs: 1,
  },
  levels: [{ id: 30, name: "Level 1", elevationFt: 0 }],
  groups: [
    groupOf("g1", {
      rootIds: [100],
      classifications: ["Supply Air"],
      systemNames: ["SA"],
      terminalCount: 2,
      elementCount: 6,
    }),
  ],
  nodes: [100, 2, 4, 6].map((id) =>
    nodeOf(id, id === 100 ? "equipment" : id === 2 ? "fitting" : "terminal", {
      uniqueId: `fixture:${id}`,
      flowParameter: "Observed flow",
      category: "duct node",
      point: [id === 100 ? 0 : id, 0, 0],
      levelId: 30,
      groupId: id === 100 ? null : "g1",
      systemName: id === 100 ? null : "SA",
      connectors: connectors(id),
      facts: id === 100 ? [factOf("mark", "FC-1")] : [],
    }),
  ),
  segments: [1, 3, 5].map((id) =>
    ductOf(id, {
      uniqueId: `fixture:${id}`,
      size: "8 in",
      diameterIn: 8,
      lengthFt: 2,
      polyline: [
        [id, 0, 0],
        [id + 1, 0, 0],
      ],
      levelId: 30,
      groupId: "g1",
      systemName: "SA",
      connectors: connectors(id),
    }),
  ),
  systems: [systemOf(900, { name: "SA", classification: "Supply Air" })],
});
