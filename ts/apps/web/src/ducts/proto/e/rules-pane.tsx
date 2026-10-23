import { useList } from "@pe/kit/lang/collection";
import { PlainList } from "@pe/kit/lang/list-view";
import { nameOrFallback } from "@pe/kit/lang/subject-text";
import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY (protoui round 3, E2): the Rules section, "the table is the product" (pressure-drop
 * ledger, 2026-10-04): a person edits a fitting type's table, never a raw coefficient; the rule is
 * family:type plus a geometry condition, and Pe re-looks-up every instance. One root row per rule
 * that governs a fitting in scope (this system, or every system), its condition,
 * instance count and the table choice inline (the one decision, on the rule's own line). A fitting with a stated drop is an exception:
 * an override row under its type's rule, its drop editable. The tree's element rows jump here.
 */
import { memo, useMemo } from "react";
import type { LossResult } from "@pe/ducts-domain/losses";
import { ruleByKey } from "@pe/ducts-domain/loss-rules";
import { unpriced, type Priced } from "@pe/ducts-domain/pricing";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { fanOutWords, ruleFanOut } from "../../inputs";
import type { LossesWork } from "../../work";
import { Chips, DropCell, StagedRules } from "./rules";
import { RuleAssignment } from "./rule-assignment";

type RuleNode =
  | { kind: "rule"; key: string; ids: number[] }
  | { kind: "override"; key: string; id: number };

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
      .flatMap(([key, set]): RuleNode[] => [
        { kind: "rule", key, ids: [...set] },
        ...overrides
          .filter((id) => ruleOf.get(id) === key)
          .map((id): RuleNode => ({ kind: "override", key: `${key}/o${id}`, id })),
      ]);
    // A stated drop with no pricing rule has no type row to sit under.
    return [
      ...rules,
      ...overrides
        .filter((id) => !ruleOf.has(id))
        .map((id): RuleNode => ({ kind: "override", key: `o${id}`, id })),
    ];
  }, [priced, ruleOf, groupOf, groups, wide]);

  // What staging each rule's table would move, known before anything is staged: the grilles
  // downstream of its instances and the systems they sit in, document-wide whatever `wide` says.
  const fanOuts = useMemo(() => {
    const trees = new Map();
    return new Map(
      roots.flatMap((n) =>
        n.kind === "rule" ? [[n.key, ruleFanOut(snapshot, ruleOf, n.key, trees)] as const] : [],
      ),
    );
  }, [roots, snapshot, ruleOf]);

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
  const list = useList({
    items: roots,
    keyOf: (n) => n.key,
    search: (n) => {
      if (n.kind === "override") return { text: [nameOf(n.id)], ids: [n.id] };
      const rule = ruleByKey(n.key);
      return { text: [n.key, rule?.family, rule?.type, rule?.cond], ids: n.ids };
    },
    followSelection: { key: focus },
    onPick: (n) => onFocus(n.key),
  });
  const unassigned = useList({
    items: unruled,
    keyOf: (n) => n.family ?? `#${[...n.ids][0]}`,
    search: (n) => ({ text: [n.family], ids: [...n.ids] }),
  });
  return (
    <div
      className="@container flex min-w-0 flex-col"
      data-e-rules={wide ? "all" : "this"}
      onMouseLeave={() => light(null)}
    >
      <PlainList
        list={list}
        aria-label="loss rules"
        empty={{ message: "No priced fittings", exit: "Read or choose another system" }}
        row={(n) => {
          if (n.kind === "override")
            return {
              label: (
                <span>
                  <span data-tone="caution">override</span> · {nameOf(n.id)}
                  <DropCell
                    segment="componentDrops"
                    id={n.id}
                    held={snapshot.nodes.find((x) => x.id === n.id)?.loss?.revitPressureDropInWg}
                    work={work}
                    label={`stated drop on ${nameOrFallback(nameOf(n.id))}`}
                  />
                </span>
              ),
              onMouseEnter: () => light([n.id]),
            };
          const rule = ruleByKey(n.key);
          const name = rule ? `${rule.family} : ${rule.type}` : n.key;
          const missing = unpriced(priced, n.key);
          return {
            label: name,
            sub: (
              <div>
                <p>{rule?.cond || "any size"}</p>
                <Chips ruleKey={n.key} priced={priced} work={work} />
                <TooltipHint content="What staging another table for this rule would re-price, in every system">
                  <span data-e-fanout={n.key}>
                    {fanOutWords(fanOuts.get(n.key) ?? { grilles: 0, systems: 0 })}
                  </span>
                </TooltipHint>
              </div>
            ),
            meta: `×${n.ids.length}${missing ? ` · ${missing} unpriced` : ""}`,
            lines: 2,
            onMouseEnter: () => light(n.ids),
          };
        }}
      />
      {unruled.length ? (
        <div className="hairline-t pt-1" data-e-unruled="">
          <p className="t-small text-ink-2 pb-1">Unassigned families</p>
          <PlainList
            list={unassigned}
            aria-label="unassigned families"
            empty={{ message: "No unassigned families", exit: "Read another system" }}
            row={({ family, ids }) => {
              const first = [...ids][0];
              const picked = family
                ? work.doc?.ruleAssignments?.[family]?.staged?.value?.rule
                : undefined;
              return {
                label: family ?? nameOf(first!),
                meta: ids.size ? `×${ids.size}` : undefined,
                lines: 2,
                onMouseEnter: () => light([...ids]),
                sub: (
                  <div
                    data-e-unruled-family={family ?? undefined}
                    data-e-unruled-ids={[...ids].join(" ")}
                  >
                    {family ? <RuleAssignment family={family} work={work} /> : null}
                    {first != null && !picked ? (
                      <DropCell
                        segment="componentDrops"
                        id={first}
                        held={
                          snapshot.nodes.find((x) => x.id === first)?.loss?.revitPressureDropInWg
                        }
                        work={work}
                        label={`stated drop on ${first}`}
                      />
                    ) : null}
                  </div>
                ),
              };
            }}
          />
        </div>
      ) : null}
      <div className="hairline-t pt-1">
        <StagedRules priced={priced} groups={wide ? [] : groups} work={work} />
      </div>
    </div>
  );
});
