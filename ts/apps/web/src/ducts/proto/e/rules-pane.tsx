/**
 * THROWAWAY (protoui round 3, E2): the Rules section, "the table is the product" (pressure-drop
 * ledger, 2026-10-04): a person edits a fitting type's table, never a raw coefficient; the rule is
 * family:type plus a geometry condition, and Pe re-looks-up every instance. One root row per rule
 * that governs a fitting in scope (this system, or every system), its table, condition and
 * instance count; opening it shows the table choice. A fitting with a stated drop is an exception:
 * an override row under its type's rule, its drop editable. The tree's element rows jump here.
 */
import { useEffect, useMemo } from "react";
import type { LossResult } from "@pe/ducts-domain/losses";
import { ruleByKey } from "@pe/ducts-domain/loss-rules";
import { tableOf, unpriced, type Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { Tree } from "@pe/kit/lang/row";
import { TooltipHint } from "@pe/kit/lang/tooltip";

import { fanOutWords, ruleFanOut } from "../../inputs";
import type { LossesWork } from "../../work";
import { Chips, DropCell, StagedRules } from "./rules";

type RuleNode =
  | { kind: "rule"; key: string; ruleKey: string; count: number; children: RuleNode[] }
  | { kind: "table"; key: string; ruleKey: string; children: RuleNode[] }
  | { kind: "override"; key: string; id: number; ruleKey: string | null; children: RuleNode[] };

/** Each fitting id's rule key, over every priced path (applied first, then staged). */
export function ruleOfIds(priced: Priced | null): Map<number, string> {
  const out = new Map<number, string>();
  const walk = (r: LossResult) => {
    for (const path of Object.values(r.paths))
      for (const row of path.rows) if (row.rule && !out.has(row.id)) out.set(row.id, row.rule);
  };
  if (priced) {
    walk(priced.now);
    walk(priced.next);
  }
  return out;
}

export function RulesTree({
  snapshot,
  priced,
  groups,
  wide,
  work,
  focus,
  onFocus,
  nameOf,
  light,
}: {
  snapshot: DuctSnapshot;
  priced: Priced;
  /** The groups of the system in the sentence (stable, `systemScope`); `wide` widens to every system. */
  groups: readonly string[];
  wide: boolean;
  work: LossesWork;
  /** The rule key the tree last jumped to; it is the cursor and scrolls into view. */
  focus: string | null;
  onFocus: (key: string | null) => void;
  nameOf: (id: number) => string;
  light: (ids: readonly number[] | null) => void;
}) {
  const groupOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const n of snapshot.nodes) if (n.groupId) m.set(n.id, n.groupId);
    return m;
  }, [snapshot]);
  const ruleOf = useMemo(() => ruleOfIds(priced), [priced]);
  const roots = useMemo(() => {
    const own = new Set(groups);
    const inScope = (id: number) => wide || own.has(groupOf.get(id) ?? "");
    const ids = new Map<string, Set<number>>();
    for (const [id, key] of ruleOf)
      if (inScope(id)) (ids.get(key) ?? ids.set(key, new Set()).get(key)!).add(id);
    const overrides = Object.keys(priced.staged.componentDrops)
      .map(Number)
      .filter(inScope);
    const rules = [...ids]
      .sort(([, a], [, b]) => b.size - a.size)
      .map(
        ([ruleKey, set]): RuleNode => ({
          kind: "rule",
          key: ruleKey,
          ruleKey,
          count: set.size,
          children: [
            { kind: "table", key: `${ruleKey}/table`, ruleKey, children: [] },
            ...overrides
              .filter((id) => ruleOf.get(id) === ruleKey)
              .map((id): RuleNode => ({ kind: "override", key: `${ruleKey}/o${id}`, id, ruleKey, children: [] })),
          ],
        }),
      );
    // A stated drop on an element no rule prices (an accessory) has no type row to sit under.
    const loose = overrides
      .filter((id) => !ruleOf.has(id))
      .map((id): RuleNode => ({ kind: "override", key: `o${id}`, id, ruleKey: null, children: [] }));
    return [...rules, ...loose];
  }, [priced, ruleOf, groupOf, groups, wide]);

  // What staging each rule's table would move, known before anything is staged: the grilles
  // downstream of its instances and the systems they sit in, document-wide whatever `wide` says.
  const fanOuts = useMemo(() => {
    const trees = new Map();
    return new Map(
      roots.flatMap((n) =>
        n.kind === "rule"
          ? [[n.ruleKey, ruleFanOut(snapshot, ruleOf, n.ruleKey, trees)] as const]
          : [],
      ),
    );
  }, [roots, snapshot, ruleOf]);

  // A jump focuses the rule's row: scroll it into view once it is drawn.
  useEffect(() => {
    if (!focus) return;
    document
      .querySelector(`[data-e-rules] [data-key="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const idsUnder = (ruleKey: string) =>
    [...ruleOf]
      .filter(([id, k]) => k === ruleKey && (wide || groups.includes(groupOf.get(id) ?? "")))
      .map(([id]) => id);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-e-rules="" onMouseLeave={() => light(null)}>
      <Tree<RuleNode>
        aria-label="loss rules"
        roots={roots}
        keyOf={(n) => n.key}
        childrenOf={(n) => n.children}
        cursor={focus}
        onCursorChange={onFocus}
        empty={wide ? "no fitting is priced by a rule" : "no fitting in this system is priced by a rule"}
        row={(n) => {
          if (n.kind === "rule") {
            const rule = ruleByKey(n.ruleKey);
            const label = rule ? `${rule.family} : ${rule.type}` : n.ruleKey;
            const missing = unpriced(priced, n.ruleKey);
            return {
              label,
              title: rule?.cond ? `${label} · ${rule.cond}` : label,
              aside: rule?.cond || undefined,
              meta: (
                <span className="inline-flex gap-2">
                  <span data-tone={priced.staged.rules[n.ruleKey] ? "caution" : undefined}>
                    {tableOf(priced, n.ruleKey)}
                  </span>
                  <span className="text-ink-2" title="instances this rule governs in scope">
                    ×{n.count}
                  </span>
                  {missing ? <span data-tone="caution" title="instances with no value under this table">{missing} unpriced</span> : null}
                  <TooltipHint content="What staging another table for this rule would re-price, in every system">
                    <span className="text-ink-2" data-e-fanout={n.ruleKey}>
                      {fanOutWords(fanOuts.get(n.ruleKey) ?? { grilles: 0, systems: 0 })}
                    </span>
                  </TooltipHint>
                </span>
              ),
              onMouseEnter: () => light(idsUnder(n.ruleKey)),
              revitIds: idsUnder(n.ruleKey),
            };
          }
          if (n.kind === "table")
            return {
              label: <Chips ruleKey={n.ruleKey} priced={priced} work={work} />,
              title: `the ASHRAE table every ${ruleByKey(n.ruleKey)?.family ?? ""} instance is looked up under`,
              onMouseEnter: () => light(idsUnder(n.ruleKey)),
              revitIds: idsUnder(n.ruleKey),
            };
          return {
            label: (
              <span>
                <span data-tone="caution">override</span> · {nameOf(n.id)}
              </span>
            ),
            title: `override: a stated drop on ${nameOf(n.id)} replaces the rule's lookup for this one fitting`,
            meta: (
              <DropCell
                segment="componentDrops"
                id={n.id}
                held={snapshot.nodes.find((x) => x.id === n.id)?.loss?.revitPressureDropInWg}
                work={work}
                label={`stated drop on ${n.id}`}
              />
            ),
            onMouseEnter: () => light([n.id]),
            revitIds: [n.id],
          };
        }}
      />
      <div className="border-line border-t px-2 py-1">
        <StagedRules priced={priced} groups={wide ? [] : groups} work={work} />
      </div>
    </div>
  );
}
