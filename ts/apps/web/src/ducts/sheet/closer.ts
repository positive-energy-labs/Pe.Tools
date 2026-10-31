/**
 * One blocker's closer, described once for every row and batch verb: the verb text that names
 * the action and the value it will apply, why it cannot run (null when live), the inline input
 * it needs (typed cfm or in-wg), and the action the hook dispatches. Pure, so the tier ledger and
 * its tests read the same words.
 *
 * Doors today (ducts LEDGER 2026-10-29): every closer is an edit on Work's own key. A join or
 * heal pair is RULED as `edits.joins` (never a Revit write; `SHIM(ducts-sheet-write)`: the typed
 * Revit heal door does not exist yet), an open end is RULED capped as `edits.ends` (R-CAP), a
 * typed drop lands in `edits.terminalDrops` or `edits.componentDrops`, a typed cfm in
 * `edits.flows` (a terminal) or `edits.equipmentFlows` (the open unit, or the unit an end lands
 * on). A fitting no table prices is priced with a table the person picks (`edits.assignments` for
 * its family where no rule matched, `edits.tables` where its rule's table is refused); a path
 * through a proposed tee or tap takes a typed drop for that path only (`edits.fittingDrops`), with
 * no default. Everything else is ruled in Revit and the row says so.
 */
import type { SheetBlocker } from "./tiers";
import { closerKind, healPair } from "./tiers";
import type { FittingPricing, Resolved } from "@pe/agent-contracts";
import { ruleByKey, ruleWords } from "@pe/ducts-domain/loss-rules";
import { tableMeaning } from "./fitting-groups";

export type CloserAction =
  | { kind: "rule"; pair: [string, string] }
  | { kind: "cap"; end: { elementId: number; connector: number } }
  | { kind: "drop"; elementId: number; value: number; terminal: boolean }
  | { kind: "cfm"; elementId: number; value: number }
  | { kind: "unitCfm"; unitId: number; value: number }
  /** Price every fitting of `family` no rule matches with `rule`; `table` swaps that rule's table too. */
  | { kind: "price"; family: string; rule: string; table: string | null }
  /** Swap the table every fitting of `rule` reads. */
  | { kind: "table"; rule: string; table: string }
  /** A typed drop on one path through a proposed fitting (`inputs.fittingDrops` key). */
  | { kind: "pathDrop"; key: string; value: number };

/** One table a fitting may be priced with: the verb names the table, `detail` the rule it reads under. */
export type PriceChoice = { verb: string; detail: string; action: CloserAction };

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
  /** The tables a not-priced fitting may be priced with ("price with CD3-3"); null when none. */
  choices?: readonly PriceChoice[] | null;
};

export type CloserContext = {
  /** The resolved default terminal drop (firm or project), with its source; null until inputs land. */
  terminalDrop: Resolved<number> | null;
  nameOf: (id: number) => string | null;
  /** The sheet-wide refusal (busy, inputs detail not yet read); null when verbs may run. */
  wait: string | null;
  /** The open fan's unit, for closers that set its design flow; null with no fan open. */
  fan?: { unitId: number; name: string } | null;
  /**
   * The other unit a fan end lands on (the inputs detail's `ends`), for a no-flow row at that
   * unit's port; null when the end is not another unit's.
   */
  receiving?: (end: {
    elementId: number;
    connector?: number;
  }) => { unitId: number; name: string } | null;
  /** A fitting's census row (the inputs detail's `fittings`), by the key its blocker names. */
  fittingOf?: (key: string) => FittingPricing | null;
  /** Each served ASHRAE table's title, by id: what a "price with" option means. */
  tableTitles?: Readonly<Record<string, string>>;
};

/**
 * The tables a fitting may be priced with, each said by what it means (the ASHRAE fitting the
 * table describes) and how far the choice reaches (kaitpw 2026-10-30: the descriptions echoed the
 * mechanism). A matched rule whose table refused it swaps the table (every fitting of that rule
 * reads it); an unmatched fitting takes a rule for its family (every fitting of the family no rule
 * matches), at the rule's own table or one of its options.
 */
export function priceChoices(
  row: FittingPricing,
  titles: Readonly<Record<string, string>> = {},
): PriceChoice[] {
  const means = (table: string) =>
    tableMeaning(table, titles) ?? "not served by this Revit's ASHRAE set";
  if (row.ruleSource === "matched" && row.rule) {
    const rule = ruleByKey(row.rule);
    const name = rule ? ruleWords(rule) : row.rule;
    return row.options
      .filter((table) => table !== row.table)
      .map((table) => ({
        verb: `price with ${table}`,
        detail: `${means(table)} · every ${name} in the document`,
        action: { kind: "table", rule: row.rule!, table },
      }));
  }
  if (!row.family) return [];
  return row.candidates.flatMap((c) =>
    c.tables.map((table, i) => ({
      verb: `price with ${table}`,
      detail: `${means(table)} · as ${c.words} · every ${row.family} no rule matches${i === 0 ? "" : `; every ${c.rule} fitting reads ${table} too`}`,
      action: {
        kind: "price" as const,
        family: row.family!,
        rule: c.rule,
        table: i === 0 ? null : table,
      },
    })),
  );
}

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
    case "not-priced":
    case "implausible-loss": {
      const row = blocker.fitting ? (context.fittingOf?.(blocker.fitting) ?? null) : null;
      if (!row) return refuse(`rule ${blocker.kind}`, blocker.closer.note || "Read inputs detail");
      const choices = priceChoices(row, context.tableTitles);
      const input: CloserInput = { unit: "in-wg", placeholder: null };
      const toward = row.proposed?.toward;
      // A proposed fitting's typed drop is per path, never seeded: no default suits a fitting.
      const typedVerb =
        typed == null
          ? null
          : row.proposed
            ? {
                verb: `set path drop ${typed} in-wg${toward == null ? " (straight)" : ` → ${nameOrId(context.nameOf, toward)}`}`,
                refusal: context.wait,
                action: { kind: "pathDrop" as const, key: row.key, value: typed },
              }
            : {
                verb: `set drop ${typed} in-wg`,
                refusal: context.wait,
                action: {
                  kind: "drop" as const,
                  elementId: blocker.elementId,
                  value: typed,
                  terminal: false,
                },
              };
      if (choices.length)
        return {
          ...base,
          verb: "price with…",
          refusal: context.wait,
          input,
          action: null,
          secondary: typedVerb,
          choices,
        };
      return typedVerb
        ? { ...live(typedVerb.verb, typedVerb.action, input) }
        : {
            ...refuse(
              row.proposed ? "set path drop" : "set drop",
              row.proposed
                ? "No table prices this path; type its drop in in-wg"
                : "No table fits this fitting; type its drop in in-wg",
            ),
            input,
          };
    }
    case "unknown-drop": {
      const terminal = blocker.detail?.startsWith("terminal") ?? false;
      // The firm's terminal drop seeds terminals only; no default suits another part.
      const fallback = terminal ? context.terminalDrop : null;
      const input: CloserInput = { unit: "in-wg", placeholder: fallback?.value ?? null };
      if (typed != null)
        return live(
          `set drop ${typed} in-wg`,
          { kind: "drop", elementId: blocker.elementId, value: typed, terminal },
          input,
        );
      return fallback == null
        ? { ...refuse("set drop", "Type the drop in in-wg"), input }
        : live(
            `set drop ${fallback.value} in-wg (${fallback.source}${fallback.ref ? ` ${fallback.ref}` : ""})`,
            { kind: "drop", elementId: blocker.elementId, value: fallback.value, terminal },
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
      // An end at another unit's port carries that unit's design flow, never a per-end share
      // (ducts LEDGER 2026-10-29, owed 6: per-end shares into another fan's port were dropped and
      // `work.flows` is read for terminals only). The engine reads a receiving unit's typed design
      // flow as the cfm this fan delivers into its port, so the row sets that unit's design flow.
      const receiving = context.receiving?.(blocker);
      if (receiving)
        return typed != null
          ? live(
              `set ${receiving.name} design flow ${typed} cfm`,
              { kind: "unitCfm", unitId: receiving.unitId, value: typed },
              input,
            )
          : { ...refuse(`set ${receiving.name} design flow`, "Type the unit's design cfm"), input };
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
