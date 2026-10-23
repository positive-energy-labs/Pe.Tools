import { type ListSearch } from "@pe/agent-contracts";
import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY (protoui round 3, E2 "tree sidebar"): B's topology (system → runs → legs → elements) as
 * the composable list tree. Each row's trailing slot: the fan-to-here total as a bar, then its own (self) loss.
 * An element a rule prices carries one verb: jump to its type's rule in the Rules section. There is
 * no per-row rule editor: a rule is global (family:type plus condition), never one fitting's.
 */
import { useEffect, useRef, useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { emptyListState, useList, type ListState } from "@pe/kit/lang/collection";
import { ListView } from "@pe/kit/lang/list-view";
import { tokenRef } from "@pe/kit/lib/token";
import { observedElements, useNativeObservation } from "#/revit/observation";

import { formatQuantity, type Encoding, type Quantity } from "../../encoding";

import type { TreeNode } from "../b/model";
import { MetaBar, MetaHeader } from "./bar";

export interface TreeCtx {
  /** One section per group the system is in, each named by the system and its units. */
  trees: readonly TreeNode[];
  /** Full bar width: the critical run's total, in-wg; null unpriced. */
  scale: number | null;
  /** The critical run's key: the run with the largest priced total. */
  criticalKey: string | null;
  /** A grille's name for a run (or a grille element): label, else type, plus place; never an id. */
  grilleName: (node: TreeNode) => string;
  /** The element id the route has selected, or null. */
  selected: number | null;
  /** Each priced fitting's rule key. */
  ruleOf: ReadonlyMap<number, string>;
  light: (ids: readonly number[] | null) => void;
  select: (id: number | null) => void;
  jumpToRule: (ruleKey: string) => void;
  /**
   * The drawing's encoding when it reads a quantity (size, flow, velocity, a drop, Pe's loss): each
   * row then shows that quantity, the largest under it, against the group's max. Null keeps the
   * fan-to-here loss.
   */
  reading: Encoding | null;
  /** The design friction rate, in-wg per 100 ft: a duct whose own rate exceeds it wears a quiet mark. */
  designRate: number;
}

/** The largest value under a node and the element that holds it. */
const peakOf = (q: Quantity, ids: readonly number[]) => {
  let best: { id: number; value: number } | null = null;
  for (const id of ids) {
    const value = q.of.get(id);
    if (value != null && (!best || value > best.value)) best = { id, value };
  }
  return best;
};

/** The bar ink of a value: its ramp step on a sequential scale, plain secondary ink otherwise. */
const inkOf = (encoding: Encoding, q: Quantity, value: number) => {
  if (encoding.kind !== "sequential") return tokenRef("ink-2");
  const i = q.edges.findIndex((edge) => value < edge);
  return encoding.bins[`b${i === -1 ? q.edges.length : i}`]?.stroke.ink ?? tokenRef("ink-2");
};

/** A row's quantity: a bar against the group's max in the value's own ramp ink, and the number. */
function QuantityBar({ encoding, ids }: { encoding: Encoding; ids: readonly number[] }) {
  const q = encoding.quantity!;
  const peak = peakOf(q, ids);
  const share = peak && q.max ? Math.min(1, peak.value / q.max) : null;
  return (
    <TooltipHint
      content={peak ? `${formatQuantity(q, peak.value)} ${q.unit}` : `no ${encoding.label} here`}
    >
      <span
        className="inline-flex items-center gap-1.5"
        data-e-quantity={peak ? peak.value : ""}
        data-e-peak={peak?.id ?? ""}
      >
        <span className="relative inline-block h-1.5 w-16" aria-hidden>
          {share != null ? (
            <>
              <span className="absolute inset-0" style={{ backgroundColor: tokenRef("line") }} />
              <span
                className="absolute inset-y-0 left-0"
                style={{
                  width: `${share * 100}%`,
                  backgroundColor: inkOf(encoding, q, peak!.value),
                }}
              />
            </>
          ) : null}
        </span>
        <span className="face-mono w-12 text-right">
          {peak ? formatQuantity(q, peak.value) : "—"}
        </span>
        {peak && peak.id === q.maxId ? (
          <TooltipHint content={`the system's max ${encoding.label}`}>
            <span className="w-6 text-ink-2">max</span>
          </TooltipHint>
        ) : (
          <span className="w-6" />
        )}
      </span>
    </TooltipHint>
  );
}

/** Every element id under a node, its own first: the set a hover lights. */
const idsOf = (node: TreeNode): number[] => {
  const out = new Set<number>();
  const walk = (n: TreeNode) => {
    if (n.kind === "element" && n.id != null) out.add(n.id);
    n.children.forEach(walk);
  };
  if (node.id != null) out.add(node.id);
  walk(node);
  return [...out];
};

export function SystemTree({
  ctx,
  address,
}: {
  ctx: TreeCtx;
  address?: {
    scope?: string;
    search: ListSearch;
    sort: "" | "name";
    onChange: (search: ListSearch, sort: "" | "name") => void;
  };
}) {
  const observation = useNativeObservation();
  // Every section opens; the critical run opens under the section that holds it (else the first's).
  const crit =
    ctx.trees.flatMap((t) => t.children).find((r) => r.key === ctx.criticalKey) ??
    ctx.trees[0]?.children[0];
  const [state, setState] = useState<ListState<"name">>(() => ({
    ...emptyListState<"name">(),
    open: [...ctx.trees.map((tree) => tree.key), ...(crit ? [crit.key] : [])],
  }));
  // A run is the path from the unit to one grille: "FC-17 → Price LBP15A Supply 12 X 6, Level 2".
  const runName = (n: TreeNode) =>
    `${n.name.split(" → ")[0]} → ${ctx.grilleName(n)}${n.level ? `, ${n.level}` : ""}`;
  const labelOf = (node: TreeNode) =>
    node.kind === "run"
      ? runName(node)
      : node.kind === "element"
        ? ctx.grilleName(node)
        : node.name;
  const idOf = (node: TreeNode) => (node.kind === "run" ? node.terminal : node.id);
  const list = useList<TreeNode, "name">({
    scope: address?.scope,
    items: ctx.trees,
    keyOf: (node) => node.key,
    tree: { childrenOf: (node) => node.children },
    search: (node) => ({
      text: [labelOf(node), node.kind, node.level],
      ids: idOf(node) == null ? [] : [idOf(node)!],
    }),
    fields: {
      kind: {
        kind: "text",
        read: (node) => node.kind,
        values: ["system", "run", "leg", "element"],
      },
    },
    sorts: { name: labelOf },
    select: "single",
    state: { ...state, search: address?.search ?? state.search, sort: address?.sort ?? state.sort },
    onState: (next) => {
      setState(next);
      if (address && (next.search !== address.search || next.sort !== address.sort))
        address.onChange(next.search, next.sort);
    },
    onPick: (node) => ctx.select(idOf(node)),
  });
  const pendingReveal = useRef<string | null>(null);
  const roots = ctx.trees.map((tree) => tree.key).join("|");
  const context = useRef("");
  useEffect(() => {
    const candidates = list.all.filter(
      ({ item }) => item.kind !== "system" && ctx.selected != null && idOf(item) === ctx.selected,
    );
    const selected =
      candidates.find((row) => row.key === list.state.selected[0]) ??
      candidates.find(({ item }) => item.kind === "element") ??
      candidates[0];
    pendingReveal.current = selected?.key ?? null;
    const nextContext = `${roots}:${ctx.criticalKey ?? ""}`;
    const changedContext = context.current !== nextContext;
    context.current = nextContext;
    const critical = changedContext
      ? list.all.find((row) => row.key === ctx.criticalKey)
      : undefined;
    list.setState({
      ...list.state,
      selected: selected ? [selected.key] : [],
      open: [
        ...new Set([
          ...list.state.open,
          ...(changedContext ? ctx.trees.map((tree) => tree.key) : []),
          ...(critical ? [...critical.ancestors, critical.key] : []),
          ...(selected?.ancestors ?? []),
        ]),
      ],
    });
    // A route selection or a new system opens context once; manual collapse remains the list's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.selected, roots, ctx.criticalKey]);
  useEffect(() => {
    const key = pendingReveal.current;
    // Core reveal clears excluded queries. Wait until its own filtered rows include the selection.
    if (key && list.state.selected.includes(key) && list.rows.some((row) => row.key === key)) {
      pendingReveal.current = null;
      list.reveal(key);
    }
  });
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" onMouseLeave={() => ctx.light(null)}>
      <ListView
        list={list}
        aria-label="system tree"
        estimate={20}
        empty={{ message: "no run in this system", exit: "Choose a system with a run" }}
        columns={{
          label: (
            <TooltipHint content="run = the path from the unit to one grille · stretch = the part between two places · part = one duct, fitting or accessory">
              <span>run · stretch · part</span>
            </TooltipHint>
          ),
          meta: ctx.reading?.quantity ? undefined : <MetaHeader />,
        }}
        row={(n) => {
          const target = observedElements(observation, idsOf(n));
          const label =
            n.kind === "run" ? runName(n) : n.kind === "element" ? ctx.grilleName(n) : n.name;
          const critical = n.kind === "run" && (n.key === ctx.criticalKey || n.critical != null);
          const over = n.rate != null && n.rate > ctx.designRate;
          const stand = n.critical === "longest" && n.key !== ctx.criticalKey;
          const ruleKey = n.kind === "element" && n.id != null ? ctx.ruleOf.get(n.id) : undefined;
          return {
            lead: critical ? (
              <TooltipHint
                content={stand ? "longest developed run: stand-in until priced" : "critical run"}
              >
                <span>{stand ? "◇" : "◆"}</span>
              </TooltipHint>
            ) : over ? (
              <TooltipHint
                content={`friction ${n.rate!.toFixed(3)} in-wg per 100 ft is over the design rate ${ctx.designRate} (a diagnostic, not a blocker)`}
              >
                <span className="text-ink-2" data-e-over={n.id ?? ""}>
                  ▴
                </span>
              </TooltipHint>
            ) : undefined,
            // Kinds read apart by weight and ink: run (a path to one grille) strong, stretch plain, part quiet.
            label: (
              <span
                className={
                  n.kind === "system" || n.kind === "run"
                    ? "font-medium"
                    : n.kind === "element"
                      ? "text-ink-2"
                      : undefined
                }
                data-e-kind={n.kind}
              >
                {label}
              </span>
            ),
            // Always a title: the kit Row wraps itself in a Tooltip only once it measures a cut
            // title, and that late wrap re-renders the row and drops the chevron's first press.
            title: label,
            meta: ctx.reading?.quantity ? (
              <QuantityBar encoding={ctx.reading} ids={idsOf(n)} />
            ) : (
              <MetaBar
                value={n.total}
                ft={n.ft}
                selfFt={n.kind === "leg" || n.kind === "element" ? n.selfFt : undefined}
                scale={ctx.scale}
                provisional={n.provisional}
                self={n.kind === "leg" || n.kind === "element" ? n.self : ""}
                unpriced={n.unpriced}
                split={n.split}
                light={ctx.light}
                rowIds={idsOf(n)}
              />
            ),
            actions: ruleKey ? (
              <Button
                icon={ListTree}
                label="jump to its type's rule"
                data-e-jump={ruleKey}
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.jumpToRule(ruleKey);
                }}
              />
            ) : undefined,
            onMouseEnter: () => ctx.light(idsOf(n)),
            revitIds: target.ids,
            revitRefs: target.refs,
          };
        }}
      />
    </div>
  );
}
