/**
 * One blocker's closer, described once for every row and batch verb: the verb text that names
 * the action and the value it will apply, why it cannot run (null when live), the inline input
 * it needs (typed cfm or in-wg), and the action the hook dispatches. Pure, so the tier ledger and
 * its tests read the same words.
 *
 * Doors today: a join or heal pair is RULED on the basis (never a Revit write;
 * `SHIM(ducts-sheet-write)`: the typed Revit heal door does not exist yet), an open end is RULED
 * capped in `DuctsSheetInputs.endRulings` (R-CAP), a typed drop lands in
 * `DuctsSheetInputs.drops`, a typed end cfm in `DuctsSheetInputs.endCfm`, both keyed by the
 * blocker's element in the one project inputs cell (R2). Everything else is ruled in Revit and
 * the row says so.
 */
import type { SheetBlocker } from "./tiers";
import { closerKind, healPair } from "./tiers";
import type { SheetDefaults } from "./types";

export type CloserAction =
  | { kind: "rule"; pair: [string, string] }
  | { kind: "cap"; end: { elementId: number; connector: number } }
  | { kind: "drop"; elementId: number; value: number }
  | { kind: "cfm"; elementId: number; value: number }
  | { kind: "unitCfm"; unitId: number; value: number };

export type CloserInput = { unit: "cfm" | "in-wg"; placeholder: number | null };

export type Closer = {
  blocker: SheetBlocker;
  /** The action and the value it applies, e.g. "set drop 0.03 in-wg (firm shim)". */
  verb: string;
  /** Why the verb cannot run; null when it is live. */
  refusal: string | null;
  /** The number the row asks for before the verb is live; null when the closer takes none. */
  input: CloserInput | null;
  action: CloserAction | null;
  /** A second, smaller verb beside the first (R-CAP: "rule capped" next to a heal); null when none. */
  secondary: { verb: string; refusal: string | null; action: CloserAction } | null;
  /**
   * A vacant port of another air class the person may accept instead (a second framed verb);
   * `first` when it is nearer than the same-class candidate, so the row orders it ahead.
   */
  crossing: {
    verb: string;
    refusal: string | null;
    action: CloserAction;
    distanceIn: number;
    first: boolean;
  } | null;
};

export type CloserContext = {
  defaults: SheetDefaults;
  /** The firm or shim terminal drop, named for the verb: "firm shim" or the provenance. */
  dropSource: string;
  nameOf: (id: number) => string | null;
  /** The sheet-wide refusal (busy, inputs detail not yet read); null when verbs may run. */
  wait: string | null;
  /** The open fan's unit, for closers that set its design flow; null with no fan open. */
  fan?: { unitId: number; name: string } | null;
};

const candidateId = (blocker: SheetBlocker): number | null =>
  blocker.closer.candidate?.toElementId ?? blocker.proposal?.to.elementId ?? null;

const nameOrId = (nameOf: CloserContext["nameOf"], id: number) => nameOf(id) ?? `element ${id}`;

export function describeCloser(
  blocker: SheetBlocker,
  typed: number | null,
  context: CloserContext,
): Closer {
  const closer = describeBase(blocker, typed, context);
  const crossing = blocker.closer.crossing;
  if (!crossing) return closer;
  const near = blocker.closer.candidate?.gapIn ?? blocker.proposal?.gapIn;
  return {
    ...closer,
    crossing: {
      verb: `accept join → ${nameOrId(context.nameOf, crossing.toElementId)} (crosses ${crossing.classes[0]}→${crossing.classes[1]} air)`,
      refusal: context.wait,
      action: { kind: "rule", pair: crossing.pair },
      distanceIn: crossing.distanceIn,
      first: near == null || crossing.distanceIn < near,
    },
  };
}

function describeBase(blocker: SheetBlocker, typed: number | null, context: CloserContext): Closer {
  const base = { blocker, input: null, action: null, secondary: null, crossing: null };
  const refuse = (verb: string, refusal: string): Closer => ({ ...base, verb, refusal });
  const live = (verb: string, action: CloserAction, input: CloserInput | null = null): Closer => ({
    ...base,
    verb,
    refusal: context.wait,
    input,
    action,
  });
  const pair = healPair(blocker);
  const to = candidateId(blocker);
  const toName = to == null ? null : nameOrId(context.nameOf, to);

  switch (blocker.kind) {
    case "open-end": {
      // R-CAP (kaitpw 2026-10-28): a person may rule an open end capped; it needs the connector.
      // An open end with no connector (the roster names no inlet) is still ruled in Revit.
      const cap: CloserAction | null =
        blocker.connector == null
          ? null
          : { kind: "cap", end: { elementId: blocker.elementId, connector: blocker.connector } };
      // SHIM(ducts-sheet-write): "heal" is a basis-bound ruling on the pair until the Revit door lands.
      if (pair && toName)
        return {
          ...live(`heal → ${toName}`, { kind: "rule", pair }),
          secondary: cap && { verb: "rule capped", refusal: context.wait, action: cap },
        };
      return cap
        ? live("rule capped", cap)
        : refuse("rule in Revit", "No heal candidate and no connector; rule the open end in Revit");
    }
    case "inferred-join": {
      // An inferred join sits at an open end; the person may rule that end capped instead of
      // accepting the candidate (a bare plenum end beside its neighbour is the Chadds case).
      const cap: CloserAction | null =
        blocker.connector == null
          ? null
          : { kind: "cap", end: { elementId: blocker.elementId, connector: blocker.connector } };
      const secondary = cap && { verb: "rule capped", refusal: context.wait, action: cap };
      return pair && toName
        ? { ...live(`accept join → ${toName}`, { kind: "rule", pair }), secondary }
        : cap
          ? live("rule capped", cap)
          : refuse("accept join", "No candidate pair to rule");
    }
    case "unknown-drop": {
      const input: CloserInput = { unit: "in-wg", placeholder: context.defaults.terminalDropInWg };
      if (typed != null)
        return live(
          `set drop ${typed} in-wg`,
          { kind: "drop", elementId: blocker.elementId, value: typed },
          input,
        );
      const shim = context.defaults.terminalDropInWg;
      return shim == null
        ? { ...refuse("set drop", "Type the drop in in-wg"), input }
        : live(
            `set drop ${shim} in-wg (${context.dropSource})`,
            { kind: "drop", elementId: blocker.elementId, value: shim },
            input,
          );
    }
    case "no-flow": {
      const input: CloserInput = { unit: "cfm", placeholder: null };
      // A side-stream unit's own flow splits across its receiving ends (A2): one design cfm for the
      // unit closes every such row, split by the policy, instead of a typed share per end.
      if (context.fan && /fan's own flow/.test(blocker.detail ?? ""))
        return typed != null
          ? live(
              `set ${context.fan.name} design flow ${typed} cfm`,
              { kind: "unitCfm", unitId: context.fan.unitId, value: typed },
              input,
            )
          : {
              ...refuse(`set ${context.fan.name} design flow`, "Type the unit's design cfm"),
              input,
            };
      return typed != null
        ? live(
            `set flow ${typed} cfm`,
            { kind: "cfm", elementId: blocker.elementId, value: typed },
            input,
          )
        : { ...refuse("set flow", "Type the cfm"), input };
    }
    default:
      if (pair && toName) return live(`accept ruling → ${toName}`, { kind: "rule", pair });
      return closerKind(blocker) === "default"
        ? refuse("re-read", blocker.closer.note || "Re-read with the element in scope")
        : refuse(`rule ${blocker.kind}`, blocker.closer.note || "No candidate pair to rule");
  }
}
