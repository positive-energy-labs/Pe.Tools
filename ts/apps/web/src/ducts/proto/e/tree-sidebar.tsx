/**
 * THROWAWAY (protoui round 3, E2 "tree sidebar"): B's topology (system → runs → legs → elements) as
 * a kit `Tree`. Each row's trailing slot: the fan-to-here total as a bar, then its own (self) loss.
 * An element a rule prices carries one verb: jump to its type's rule in the Rules section. There is
 * no per-row rule editor: a rule is global (family:type plus condition), never one fitting's.
 */
import { useState } from "react";
import { ListTree } from "lucide-react";
import { Button } from "@pe/kit/lang/button";
import { SearchControl } from "@pe/kit/lang/search-control";
import { Tree } from "@pe/kit/lang/row";
import { tokenRef } from "@pe/kit/lib/token";

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
    <span
      className="inline-flex items-center gap-1.5"
      data-e-quantity={peak ? peak.value : ""}
      data-e-peak={peak?.id ?? ""}
      title={peak ? `${formatQuantity(q, peak.value)} ${q.unit}` : `no ${encoding.label} here`}
    >
      <span className="relative inline-block h-1.5 w-16" aria-hidden>
        {share != null ? (
          <>
            <span className="absolute inset-0" style={{ backgroundColor: tokenRef("line") }} />
            <span
              className="absolute inset-y-0 left-0"
              style={{ width: `${share * 100}%`, backgroundColor: inkOf(encoding, q, peak!.value) }}
            />
          </>
        ) : null}
      </span>
      <span className="face-mono w-12 text-right">
        {peak ? formatQuantity(q, peak.value) : "—"}
      </span>
      {peak && peak.id === q.maxId ? (
        <span className="w-6 text-ink-2" title={`the system's max ${encoding.label}`}>
          max
        </span>
      ) : (
        <span className="w-6" />
      )}
    </span>
  );
}

/** Every element id under a node, its own first: the set a hover lights. */
export const idsOf = (node: TreeNode): number[] => {
  const out = new Set<number>();
  const walk = (n: TreeNode) => {
    if (n.kind === "element" && n.id != null) out.add(n.id);
    n.children.forEach(walk);
  };
  if (node.id != null) out.add(node.id);
  walk(node);
  return [...out];
};

/**
 * Go to an element id, a unit's tag or label, or a system name in the snapshot already read (`navigate`);
 * `go` moves the page and answers where it went, or that the input is not in this snapshot.
 */
export function GoTo({ go }: { go: (query: string) => string }) {
  const [says, setSays] = useState<string | null>(null);
  return (
    <div className="border-line flex flex-col gap-0.5 border-b px-2 py-1" data-e-goto="">
      <SearchControl>
        <input
          aria-label="go to an element id, a unit tag or a system"
          placeholder="element id, tag (FC-17) or system"
          className="min-w-0 flex-1 bg-transparent outline-none"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            setSays(go(event.currentTarget.value));
          }}
        />
      </SearchControl>
      {says ? (
        <span className="t-small text-ink-2" data-e-goto-says="">
          {says}
        </span>
      ) : null}
    </div>
  );
}

export function SystemTree({ ctx }: { ctx: TreeCtx }) {
  // Every section opens; the critical run opens under the section that holds it (else the first's).
  const crit =
    ctx.trees.flatMap((t) => t.children).find((r) => r.key === ctx.criticalKey) ??
    ctx.trees[0]?.children[0];
  // Controlled: the kit Tree's own state is fine too; kept here so a jump could open a run later.
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set([...ctx.trees.map((t) => t.key), ...(crit ? [crit.key] : [])]),
  );
  // A run is the path from the unit to one grille: "FC-17 → Price LBP15A Supply 12 X 6, Level 2".
  const runName = (n: TreeNode) =>
    `${n.name.split(" → ")[0]} → ${ctx.grilleName(n)}${n.level ? `, ${n.level}` : ""}`;
  return (
    <Tree<TreeNode>
      aria-label="system tree"
      roots={ctx.trees}
      keyOf={(n) => n.key}
      childrenOf={(n) => n.children}
      open={open}
      onOpenChange={setOpen}
      onPick={(n) => ctx.select(n.kind === "run" ? n.terminal : n.id)}
      empty="no run in this system"
      columns={{
        label: (
          <span title="run = the path from the unit to one grille · stretch = the part between two places · part = one duct, fitting or accessory">
            run · stretch · part
          </span>
        ),
        meta: ctx.reading?.quantity ? undefined : <MetaHeader />,
      }}
      row={(n) => {
        const label =
          n.kind === "run" ? runName(n) : n.kind === "element" ? ctx.grilleName(n) : n.name;
        const critical = n.kind === "run" && (n.key === ctx.criticalKey || n.critical != null);
        const over = n.rate != null && n.rate > ctx.designRate;
        const stand = n.critical === "longest" && n.key !== ctx.criticalKey;
        const ruleKey = n.kind === "element" && n.id != null ? ctx.ruleOf.get(n.id) : undefined;
        return {
          lead: critical ? (
            <span title={stand ? "longest developed run: stand-in until priced" : "critical run"}>
              {stand ? "◇" : "◆"}
            </span>
          ) : over ? (
            <span
              className="text-ink-2"
              data-e-over={n.id ?? ""}
              title={`friction ${n.rate!.toFixed(3)} in-wg per 100 ft is over the design rate ${ctx.designRate} (a diagnostic, not a blocker)`}
            >
              ▴
            </span>
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
          selected:
            ctx.selected != null &&
            n.kind !== "system" &&
            (n.kind === "run" ? n.terminal : n.id) === ctx.selected,
          onMouseEnter: () => ctx.light(idsOf(n)),
          revitIds: idsOf(n),
        };
      }}
    />
  );
}
