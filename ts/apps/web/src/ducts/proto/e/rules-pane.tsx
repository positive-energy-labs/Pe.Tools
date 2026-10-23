import { revitTarget } from "@pe/kit/lang/row";
import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY (protoui round 3, E2): the Rules section, "the table is the product" (pressure-drop
 * ledger, 2026-10-04): a person edits a fitting type's table, never a raw coefficient; the rule is
 * family:type plus a geometry condition, and Pe re-looks-up every instance. One root row per rule
 * that governs a fitting in scope (this system, or every system), its condition,
 * instance count and the table choice inline (the one decision, on the rule's own line). A fitting with a stated drop is an exception:
 * an override row under its type's rule, its drop editable. The tree's element rows jump here.
 */
import { memo, useEffect, useMemo } from "react";
import type { LossResult } from "@pe/ducts-domain/losses";
import { ruleByKey } from "@pe/ducts-domain/loss-rules";
import { unpriced, type Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { fanOutWords, ruleFanOut } from "../../inputs";
import type { LossesWork } from "../../work";
import { Chips, DropCell, StagedRules } from "./rules";
import { RuleAssignment } from "./rule-assignment";

type RuleNode =
  | { kind: "rule"; key: string; ruleKey: string; count: number; children: RuleNode[] }
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

// Memoized: a selection, a hover or a camera move never re-renders the rules (107 ms per selection
// on Chadds SA 4 before, dev build); only its own inputs do.
export const RulesTree = memo(function RulesTree({
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
    const overrides = Object.keys(priced.staged.componentDrops).map(Number).filter(inScope);
    const rules = [...ids]
      .sort(([, a], [, b]) => b.size - a.size)
      .map(
        ([ruleKey, set]): RuleNode => ({
          kind: "rule",
          key: ruleKey,
          ruleKey,
          count: set.size,
          children: [
            ...overrides
              .filter((id) => ruleOf.get(id) === ruleKey)
              .map(
                (id): RuleNode => ({
                  kind: "override",
                  key: `${ruleKey}/o${id}`,
                  id,
                  ruleKey,
                  children: [],
                }),
              ),
          ],
        }),
      );
    // A stated drop on an element no rule prices (an accessory) has no type row to sit under.
    const loose = overrides
      .filter((id) => !ruleOf.has(id))
      .map(
        (id): RuleNode => ({ kind: "override", key: `o${id}`, id, ruleKey: null, children: [] }),
      );
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
      .querySelector(`[data-e-rules="this"] [data-key="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const idsUnder = (ruleKey: string) =>
    [...ruleOf]
      .filter(([id, k]) => k === ruleKey && (wide || groups.includes(groupOf.get(id) ?? "")))
      .map(([id]) => id);

  // Fittings no rule prices, by family, plus the families a person has assigned a rule to.
  const unruled = useMemo(() => {
    const own = new Set(groups);
    const inScope = (id: number) => wide || own.has(groupOf.get(id) ?? "");
    const byFamily = new Map<string, { family: string | null; ids: Set<number> }>();
    for (const path of Object.values(priced.next.paths))
      for (const row of path.rows)
        if (row.finding === "no-rule" && inScope(row.id)) {
          const key = row.family ?? `#${row.id}`;
          const at = byFamily.get(key) ?? { family: row.family ?? null, ids: new Set<number>() };
          at.ids.add(row.id);
          byFamily.set(key, at);
        }
    for (const family of Object.keys(priced.staged.ruleAssignments))
      if (!byFamily.has(family)) byFamily.set(family, { family, ids: new Set() });
    return [...byFamily.values()].sort((a, b) => b.ids.size - a.ids.size);
  }, [priced, groupOf, groups, wide]);
  const overrideRow = (n: Extract<RuleNode, { kind: "override" }>, nested = false) => {
    return (
      <TooltipHint
        key={n.key}
        content={`override: a stated drop on ${nameOf(n.id)} replaces the rule's lookup for this one fitting`}
      >
        <div
          {...revitTarget([n.id])}
          data-key={nested ? undefined : n.key}
          className={`${COLS} items-baseline ${nested ? "pt-0.5" : "py-1"}`}
          onMouseEnter={() => light([n.id])}
        >
          <p className="t-small min-w-0 break-words">
            <span data-tone="caution">override</span> · {nameOf(n.id)}
          </p>
          <DropCell
            segment="componentDrops"
            id={n.id}
            held={snapshot.nodes.find((x) => x.id === n.id)?.loss?.revitPressureDropInWg}
            work={work}
            label={`stated drop on ${n.id}`}
          />
        </div>
      </TooltipHint>
    );
  };

  // Keep both columns aligned; stack only when the pane cannot hold a readable pair.
  const COLS =
    "grid grid-cols-1 @min-[360px]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-2 gap-y-1";
  return (
    <div
      className="@container flex min-w-0 flex-col px-(--item-mark-pad-x)"
      data-e-rules={wide ? "all" : "this"}
      onMouseLeave={() => light(null)}
    >
      <ul aria-label="loss rules" className="flex flex-col">
        {roots.length === 0 ? (
          <li className="text-ink-2 t-small py-1">No priced fittings</li>
        ) : null}
        {roots.map((n) => {
          if (n.kind === "override") return overrideRow(n);
          const rule = ruleByKey(n.ruleKey);
          const name = rule ? `${rule.family} : ${rule.type}` : n.ruleKey;
          const missing = unpriced(priced, n.ruleKey);
          return (
            <li
              key={n.key}
              {...revitTarget(idsUnder(n.ruleKey))}
              data-key={n.key}
              data-highlighted={focus === n.key ? "" : undefined}
              className="hairline-b py-1 last:border-b-0"
              onMouseEnter={() => light(idsUnder(n.ruleKey))}
              onClick={() => onFocus(n.key)}
            >
              <div className={COLS}>
                <div className="min-w-0">
                  <TooltipHint content={rule?.cond ? `${name} · ${rule.cond}` : name}>
                    <p className="wrap-anywhere">{name}</p>
                  </TooltipHint>
                  <p className="t-small text-ink-2 wrap-anywhere">{rule?.cond || "any size"}</p>
                </div>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Chips ruleKey={n.ruleKey} priced={priced} work={work} />
                  <p className="t-small text-ink-2 flex flex-wrap items-center gap-x-2">
                    <TooltipHint content="instances this rule governs in scope">
                      <span>×{n.count}</span>
                    </TooltipHint>
                    {missing ? (
                      <TooltipHint content="instances with no value under this table">
                        <span data-tone="caution">{missing} unpriced</span>
                      </TooltipHint>
                    ) : null}
                    <TooltipHint content="What staging another table for this rule would re-price, in every system">
                      <span data-e-fanout={n.ruleKey}>
                        {fanOutWords(fanOuts.get(n.ruleKey) ?? { grilles: 0, systems: 0 })}
                      </span>
                    </TooltipHint>
                  </p>
                </div>
              </div>
              {n.children.map((o) =>
                overrideRow(o as Extract<RuleNode, { kind: "override" }>, true),
              )}
            </li>
          );
        })}
      </ul>
      {unruled.length ? (
        <div className="border-line border-t pt-1" data-e-unruled="">
          <p className="t-small text-ink-2 pb-1">Unassigned families</p>
          {unruled.map(({ family, ids }) => {
            const first = [...ids][0];
            const picked = family
              ? work.doc?.ruleAssignments?.[family]?.staged?.value?.rule
              : undefined;
            return (
              <div
                key={family ?? `#${first}`}
                className={`${COLS} items-baseline py-0.5`}
                {...revitTarget([...ids])}
                data-e-unruled-family={family ?? undefined}
                data-e-unruled-ids={[...ids].join(" ")}
                onMouseEnter={() => light([...ids])}
              >
                <p className="min-w-0 wrap-anywhere">
                  {family ?? nameOf(first!)}
                  {ids.size ? <span className="t-small text-ink-2"> ×{ids.size}</span> : null}
                </p>
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  {family ? <RuleAssignment family={family} work={work} /> : null}
                  {first != null && !picked ? (
                    <DropCell
                      segment="componentDrops"
                      id={first}
                      held={snapshot.nodes.find((x) => x.id === first)?.loss?.revitPressureDropInWg}
                      work={work}
                      label={`stated drop on ${first}`}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="border-line border-t pt-1">
        <StagedRules priced={priced} groups={wide ? [] : groups} work={work} />
      </div>
    </div>
  );
});
