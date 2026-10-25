import { useContext } from "react";
import { AttentionDocument } from "@pe/kit/lang/attention";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { useCallback } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { useList, type ListPersist } from "@pe/kit/lang/collection";
import { ListView, listColumns, type ListRowParts } from "@pe/kit/lang/list-view";
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

const QUANTITY = listColumns({
  bar: { kind: "bar", priority: 1 },
  value: { kind: "number", priority: 0 },
  mark: { kind: "number", priority: 2 },
});

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
        <span {...QUANTITY.bar} className="relative h-1.5" aria-hidden>
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
        <span {...QUANTITY.value} className="face-mono">
          {peak ? formatQuantity(q, peak.value) : "—"}
        </span>
        {peak && peak.id === q.maxId ? (
          <TooltipHint content={`the system's max ${encoding.label}`}>
            <span {...QUANTITY.mark} className="text-ink-2">
              max
            </span>
          </TooltipHint>
        ) : (
          <span {...QUANTITY.mark} />
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

const idOf = (node: TreeNode) => (node.kind === "run" ? node.terminal : node.id);
const childrenOf = (node: TreeNode) => node.children;

export function SystemTree({ ctx, address }: { ctx: TreeCtx; address?: ListPersist<"name"> }) {
  const observation = useNativeObservation();
  const doc = useContext(AttentionDocument);
  // Every section opens; the critical run opens under the section that holds it (else the first's).
  const crit =
    ctx.trees.flatMap((t) => t.children).find((r) => r.key === ctx.criticalKey) ??
    ctx.trees[0]?.children[0];
  // A run is the path from the unit to one grille: "FC-17 → Price LBP15A Supply 12 X 6, Level 2".
  const runName = useCallback(
    (n: TreeNode) =>
      `${n.name.split(" → ")[0]} → ${ctx.grilleName(n)}${n.level ? `, ${n.level}` : ""}`,
    [ctx.grilleName],
  );
  const labelOf = useCallback(
    (node: TreeNode) =>
      node.kind === "run"
        ? runName(node)
        : node.kind === "element"
          ? ctx.grilleName(node)
          : node.name,
    [runName, ctx.grilleName],
  );
  const search = useCallback(
    (node: TreeNode) => ({
      text: [labelOf(node), node.kind, node.level],
      ids: idOf(node) == null ? [] : [idOf(node)!],
    }),
    [labelOf],
  );
  const list = useList<TreeNode, "name">({
    persist: address,
    items: ctx.trees,
    keyOf: (node) => node.key,
    tree: { childrenOf },
    search,
    fields: {
      kind: {
        kind: "text",
        read: (node) => node.kind,
        values: ["system", "run", "leg", "element"],
      },
    },
    sorts: { name: labelOf },
    select: "single",
    initialState: { open: [...ctx.trees.map((tree) => tree.key), ...(crit ? [crit.key] : [])] },
    followSelection: {
      context: `${ctx.trees.map((tree) => tree.key).join("|")}:${ctx.criticalKey ?? ""}`,
      open: [...ctx.trees.map((tree) => tree.key), ...(crit ? [crit.key] : [])],
      key: (rows, selected) => {
        const candidates = rows.filter(
          ({ item }) =>
            item.kind !== "system" && ctx.selected != null && idOf(item) === ctx.selected,
        );
        return (
          (
            candidates.find((row) => row.key === selected[0]) ??
            candidates.find(({ item }) => item.kind === "element") ??
            candidates[0]
          )?.key ?? null
        );
      },
    },
    onPick: (node) => ctx.select(idOf(node)),
  });
  // Stable across a selection: the kit then redraws only the rows whose selected or cursor state moved.
  const row = useCallback(
    (n: TreeNode): ListRowParts => {
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
        subject: doc
          ? { doc, key: n.kind === "element" ? `e:${n.id}` : `${n.kind}:${n.key}` }
          : undefined,
        revit: target.ids,
        revitRefs: target.refs,
      };
    },
    [
      doc,
      observation,
      runName,
      ctx.grilleName,
      ctx.criticalKey,
      ctx.designRate,
      ctx.ruleOf,
      ctx.reading,
      ctx.scale,
      ctx.jumpToRule,
    ],
  );
  return (
    <div className="min-w-0">
      <ListView
        list={list}
        aria-label="system tree"
        empty={{ message: "no run in this system", exit: "Choose a system with a run" }}
        columns={{
          label: (
            <TooltipHint content="run = the path from the unit to one grille · stretch = the part between two places · part = one duct, fitting or accessory">
              <span>run · stretch · part</span>
            </TooltipHint>
          ),
          // A quantity reading labels its bars here, where the header block's legend used to sit.
          meta: ctx.reading?.quantity ? (
            <TooltipHint content="bar = the largest under each row; full width = the system's max">
              <span data-e-legend={ctx.reading.key}>
                {ctx.reading.label}, {ctx.reading.quantity.unit} · max{" "}
                <span className="face-mono">
                  {ctx.reading.quantity.max == null
                    ? "—"
                    : formatQuantity(ctx.reading.quantity, ctx.reading.quantity.max)}
                </span>
              </span>
            </TooltipHint>
          ) : (
            <MetaHeader />
          ),
        }}
        row={row}
      />
    </div>
  );
}
