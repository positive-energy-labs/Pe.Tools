/** Test support: every roster fan's calc on a snapshot, built the way the `ducts.pricing` read builds them. */
import type { Calc } from "@pe/ducts-domain/calc-runs";
import { suggestRoster } from "@pe/ducts-domain/roster";
import { buildSheet } from "@pe/ducts-domain/sheet/index";
import { inputsFor, TEST_WALK, type InputsShorthand } from "@pe/ducts-domain/sheet/test-inputs";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

export function calcsOf(snapshot: DuctSnapshot, shorthand: InputsShorthand = {}): Calc[] {
  const suggested = suggestRoster(snapshot);
  const roster = [...suggested.fans, ...suggested.suggestions];
  const inputs = inputsFor(snapshot, shorthand);
  return roster.map((fan) => buildSheet({ snapshot, roster, fan, grids: {}, inputs }));
}

/** A hand-built leg: only what the panes' projections read. */
export const legOf = (id: string, elementId: number, kind: Calc["legs"][string]["kind"], lossInWg: number | null) =>
  ({
    id,
    elementId,
    kind,
    flowCfm: null,
    flowSource: null,
    velocityFpm: null,
    lossInWg,
    lossSource: { kind: "drop", ref: id },
    equivalentFt: null,
    evidence: { kind: "unpriced", issueId: `pricing:${id}` },
  }) satisfies Calc["legs"][string];

/** A hand-built calc of one fan: its legs and the terminal paths over them, nothing else. */
export const calcOf = (
  unitId: number,
  legs: readonly Calc["legs"][string][],
  paths: readonly { terminal: number; legIds: string[] }[],
) =>
  ({
    fan: { unitId, portIndex: 0, mark: `F-${unitId}` },
    legs: Object.fromEntries(legs.map((leg) => [leg.id, leg])),
    paths: paths.map(({ terminal, legIds }) => ({
      side: "supply",
      legIds,
      end: { kind: "terminal", elementId: terminal },
      knownInWg: legIds.reduce((sum, id) => sum + (legs.find((leg) => leg.id === id)?.lossInWg ?? 0), 0),
      blockerIds: [],
    })),
    blockers: [],
    fittings: [],
    walkedElementIds: legs.map((leg) => leg.elementId),
    encounters: [],
    claim: { kind: "incomplete", basis: "test", knownInWg: 0, coverage: [], blockingIds: [] },
  }) as unknown as Calc;

/**
 * The synthetic snapshot with a fan the roster can find: its unit's connector reads `out` (the saved
 * capture says `bidirectional`, so no port is suggested and the system reads fanless), on a walk
 * that read every peer.
 */
export const withFan = (snapshot: DuctSnapshot): DuctSnapshot => ({
  ...snapshot,
  walk: TEST_WALK,
  nodes: snapshot.nodes.map((node) =>
    node.kind === "equipment"
      ? { ...node, connectors: node.connectors.map((c) => ({ ...c, direction: "out" as const })) }
      : node,
  ),
});

/** The panes' view over hand-built calcs alone: no survey, an empty network. */
export const pricedOf = (calcs: readonly Calc[]) =>
  ({ calcs, snapshot: { segments: [] } }) as unknown as import("./priced").Priced;
