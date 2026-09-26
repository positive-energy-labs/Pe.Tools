/**
 * T1 `tree`: the selected group as a one-line schematic, fan at the left, registers at the right.
 * Straight runs fold into one edge labelled size, developed length and pass-1 cfm; the edge's
 * width is its cfm, so demand visibly thickens toward the root. Selecting an edge unfolds it.
 * The layout is a tidy tree: each vertex's first child continues its row (the longest run
 * first, so it reads straight along the top) and later children hang below.
 */
import { useMemo } from "react";

import { EmptyState } from "#/components/lang/empty";
import { Pane } from "#/components/lang/pane";
import type { VerdictTone } from "#/components/master-table/model";
import { tokenRef } from "#/lib/token";
import { ISSUE_KINDS, IssueLegend, type IssueKind } from "./issues";
import type { DuctsPage } from "./manifest";
import type { DuctSnapshot } from "./readiness";
import { chainsOf, groupTree, terminalCfm, type Chain, type GroupTree } from "./topology";

const COL = 168;
const ROW = 40;
const PAD = 24;
const ROOT_W = 132;

/** A tone's ink role: `mute` is the one tone with no role of its own name. */
export const inkOf = (tone: VerdictTone) => tokenRef(tone === "mute" ? "ink-mute" : tone);
const issueInk = (kind: IssueKind) => inkOf(ISSUE_KINDS[kind].color.tone);

interface Placed {
  chain: Chain;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TreeLayout {
  placed: Placed[];
  at: Map<number, [number, number]>;
  width: number;
  height: number;
}

/** Deterministic tidy layout: x by vertex depth, y by leaf slot, first child on its parent's row. */
export function layoutTree(tree: GroupTree, chains: Chain[]): TreeLayout {
  const below = new Map<number | null, Chain[]>();
  for (const chain of chains) below.set(chain.from, [...(below.get(chain.from) ?? []), chain]);
  const reach = new Map<number, number>();
  const farthest = (chain: Chain): number => {
    const known = reach.get(chain.to);
    if (known != null) return known;
    const kids = below.get(chain.to) ?? [];
    const value = kids.length ? Math.max(...kids.map(farthest)) : tree.dist.get(chain.to)!;
    reach.set(chain.to, value);
    return value;
  };
  const ordered = (from: number | null) =>
    [...(below.get(from) ?? [])].sort((a, b) => farthest(b) - farthest(a) || a.to - b.to);

  const placed: Placed[] = [];
  const at = new Map<number, [number, number]>();
  let slot = 0;
  let deepest = 0;
  const place = (chain: Chain, depth: number, x1: number, y1: number) => {
    const kids = ordered(chain.to);
    const y2 = PAD + slot * ROW;
    const x2 = ROOT_W + depth * COL;
    deepest = Math.max(deepest, depth);
    at.set(chain.to, [x2, y2]);
    placed.push({ chain, x1, y1, x2, y2 });
    if (!kids.length) slot++;
    kids.forEach((kid) => place(kid, depth + 1, x2, y2));
  };
  for (const chain of ordered(null)) place(chain, 1, ROOT_W - 12, PAD + slot * ROW);
  return {
    placed,
    at,
    width: ROOT_W + deepest * COL + 340,
    height: PAD * 2 + Math.max(slot - 1, 0) * ROW + 24,
  };
}

const fmt = (value: number, digits = 0) => value.toFixed(digits);
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function DuctsTree({
  snapshot,
  page,
  setPage,
  empty,
}: {
  snapshot: DuctSnapshot | null;
  page: DuctsPage;
  setPage: (next: Partial<DuctsPage>) => void;
  empty: { says: string; exit: string } | null;
}) {
  const tree = useMemo(
    () => (snapshot && page.group ? groupTree(snapshot, page.group) : null),
    [snapshot, page.group],
  );
  const selected = page.selected ? Number(page.selected) : null;
  // The chain a selected fold member sits in unfolds: its members become vertices.
  const base = useMemo(() => (tree ? chainsOf(tree) : []), [tree]);
  const unfold = useMemo(() => {
    const hit = base.find((c) => selected != null && c.members.slice(0, -1).includes(selected));
    return new Set(hit?.members ?? []);
  }, [base, selected]);
  const chains = useMemo(() => (tree ? chainsOf(tree, unfold) : []), [tree, unfold]);
  const layout = useMemo(() => (tree ? layoutTree(tree, chains) : null), [tree, chains]);

  if (empty || !snapshot || !tree || !layout)
    return (
      <Pane kind="content" title="tree">
        <EmptyState story="scope" exit={empty?.exit ?? "choose a group in the sentence"}>
          {empty?.says ?? "no group chosen: the tree draws one group"}
        </EmptyState>
      </Pane>
    );

  const maxCfm = Math.max(1, ...chains.map((c) => c.cfm ?? 0));
  const widthOf = (cfm: number | null) => (cfm == null ? 1 : 1.5 + 7 * Math.sqrt(cfm / maxCfm));
  const onLongest = new Set(tree.longest);
  const longestFt = tree.longest.length ? tree.dist.get(tree.longest.at(-1)!)! : null;
  const flowed = chains.some((c) => c.cfm != null);
  const equipment = snapshot.nodes.find((n) => n.id === tree.root?.equipment);
  const pick = (id: number) => setPage({ selected: selected === id ? "" : String(id) });
  const rootY = layout.placed.find((p) => p.chain.from === null)?.y1 ?? PAD;

  return (
    <Pane
      kind="content"
      title="tree"
      meta={`${tree.groupId} · ${tree.terminals.length} terminals`}
      scroll="clip"
      flush
    >
      <div className="flex size-full min-h-0 flex-col">
        <div className="flex flex-col gap-1 px-2 py-1 t-small">
          <span data-tone={tree.rooted === "stand-in" ? "caution" : undefined}>
            {tree.rootWord}.
          </span>
          <span className="text-ink-2">
            Edge width is pass-1 cfm, summed from the terminals up to the root
            {flowed
              ? "."
              : "; this group has none (C# sums flow only for one-port groups with no loop), so every edge is a hairline."}{" "}
            {longestFt != null
              ? `The dark run is the longest developed length, ${fmt(longestFt, 1)} ft of straight duct: the stand-in for the critical path until a loss solver adds fitting losses.`
              : "No terminal is reached from the root, so there is no longest run."}
          </span>
          <IssueLegend />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <svg
            role="img"
            aria-label={`duct tree of ${tree.groupId}`}
            width={layout.width}
            height={layout.height}
            className="face-mono t-small"
          >
            <g
              onClick={() => tree.root && pick(tree.root.element)}
              className="cursor-pointer"
              aria-label="root"
            >
              <title>{tree.rootWord}</title>
              <rect
                x={4}
                y={rootY - 12}
                width={ROOT_W - 16}
                height={24}
                fill={tokenRef("artifact")}
                stroke={tokenRef(tree.rooted === "port" ? "ink" : "caution")}
                className={tree.rooted === "port" ? undefined : "dash-reference"}
              />
              <text x={10} y={rootY} dominantBaseline="central" fill={tokenRef("ink")}>
                {clip(
                  equipment ? (equipment.family ?? `equipment ${equipment.id}`) : "stand-in root",
                  16,
                )}
              </text>
            </g>
            {layout.placed.map(({ chain, x1, y1, x2, y2 }) => {
              const bend = x1 + 10;
              const d = `M${x1} ${y1} H${bend} V${y2} H${x2}`;
              const hot = selected != null && chain.members.includes(selected);
              const long = onLongest.has(chain.to);
              const issues = chain.members
                .flatMap((id) => tree.issuesByElement.get(id) ?? [])
                .filter((i) => i.kind !== "open-end");
              const kinds = [...new Set(issues.map((i) => i.kind))];
              const labelX = bend + 6;
              return (
                <g
                  key={chain.to}
                  data-element={chain.members[0]}
                  className="cursor-pointer"
                  onClick={() => pick(chain.members[0]!)}
                >
                  <title>
                    {`${chain.members.length} element${chain.members.length === 1 ? "" : "s"}: ${chain.members.join(", ")}${chain.members.length > 1 ? " (select to unfold)" : ""}`}
                  </title>
                  {hot ? (
                    <path
                      d={d}
                      fill="none"
                      stroke={tokenRef("select")}
                      strokeWidth={widthOf(chain.cfm) + 8}
                    />
                  ) : null}
                  <path
                    d={d}
                    fill="none"
                    stroke={tokenRef(long ? "ink" : "ink-mute")}
                    strokeWidth={widthOf(chain.cfm) + (long ? 1.5 : 0)}
                  />
                  <text x={labelX} y={y2 - 6} fill={tokenRef("ink-2")}>
                    {[
                      chain.sizes.slice(0, 2).join("→"),
                      chain.lengthFt ? `${fmt(chain.lengthFt, 1)} ft` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </text>
                  <text x={labelX} y={y2 + 13} fill={tokenRef("ink")}>
                    {chain.cfm != null ? `${fmt(chain.cfm)} cfm` : ""}
                  </text>
                  {kinds.map((kind, i) => (
                    <circle
                      key={kind}
                      cx={x2 - 8 - i * 9}
                      cy={y2 + 9}
                      r={3.5}
                      fill={issueInk(kind)}
                    >
                      <title>{`${ISSUE_KINDS[kind].label}: ${ISSUE_KINDS[kind].what}`}</title>
                    </circle>
                  ))}
                  <Vertex
                    tree={tree}
                    id={chain.to}
                    x={x2}
                    y={y2}
                    hot={selected === chain.to}
                    far={tree.longest.at(-1) === chain.to}
                  />
                </g>
              );
            })}
            {tree.backEdges.map(([a, b]) => {
              const pa = layout.at.get(a);
              const pb = layout.at.get(b);
              if (!pa || !pb) return null;
              const lift = Math.max(24, Math.abs(pa[1] - pb[1]) / 2);
              return (
                <path
                  key={`${a}-${b}`}
                  d={`M${pa[0]} ${pa[1]} C${pa[0] + lift} ${pa[1]}, ${pb[0] + lift} ${pb[1]}, ${pb[0]} ${pb[1]}`}
                  fill="none"
                  stroke={issueInk("loop")}
                  strokeWidth={1.5}
                  className="dash-seam"
                >
                  <title>{`${ISSUE_KINDS.loop.label}: ${a} meets ${b} again. ${ISSUE_KINDS.loop.what}`}</title>
                </path>
              );
            })}
          </svg>
        </div>
      </div>
    </Pane>
  );
}

/** A vertex's mark: terminal square with design cfm, cap bar, branch dot, open end, extra root. */
function Vertex({
  tree,
  id,
  x,
  y,
  hot,
  far,
}: {
  tree: GroupTree;
  id: number;
  x: number;
  y: number;
  hot: boolean;
  far: boolean;
}) {
  const part = tree.parts.get(id)!;
  const kind = part.node?.kind;
  const open = (tree.issuesByElement.get(id) ?? []).filter((i) => i.kind === "open-end");
  const extra = tree.extraRoots.filter((r) => r.element === id);
  const cfm = terminalCfm(part.node);
  const label =
    kind === "terminal"
      ? cfm != null
        ? `${fmt(cfm)} cfm design · ${id}${far ? ` · longest run ${fmt(tree.dist.get(id)!, 1)} ft` : ""}`
        : `no design flow · ${id}${far ? " · longest run" : ""}`
      : kind === "cap"
        ? `cap · ${id}`
        : null;
  return (
    <g data-vertex={id}>
      <title>{`${id}: ${part.node ? (part.node.partType ?? part.node.kind) : (part.segment?.kind ?? "")}`}</title>
      {hot ? <circle cx={x} cy={y} r={9} fill={tokenRef("select")} /> : null}
      {kind === "terminal" ? (
        <rect
          x={x - 4}
          y={y - 4}
          width={8}
          height={8}
          fill={cfm != null ? tokenRef("ink") : issueInk("no-terminal-flow")}
        />
      ) : kind === "cap" ? (
        <path d={`M${x} ${y - 6} V${y + 6}`} stroke={tokenRef("ink")} strokeWidth={2.5} />
      ) : (
        <circle cx={x} cy={y} r={2.5} fill={tokenRef("ink-2")} />
      )}
      {label ? (
        <text
          x={x + 8}
          y={y}
          dominantBaseline="central"
          fill={cfm == null && kind === "terminal" ? issueInk("no-terminal-flow") : tokenRef("ink")}
        >
          {label}
        </text>
      ) : null}
      {open.map((issue, i) => (
        <g key={issue.id}>
          <path
            d={`M${x} ${y} l${22} ${10 + i * 8}`}
            stroke={issueInk("open-end")}
            strokeWidth={1.5}
            className="dash-void"
          />
          <text x={x + 24} y={y + 14 + i * 8} fill={issueInk("open-end")}>
            {ISSUE_KINDS["open-end"].label}
          </text>
          <title>{`${issue.id}: ${issue.note}`}</title>
        </g>
      ))}
      {extra.map((root, i) => (
        <g key={`${root.equipment}:${root.port}`}>
          <rect
            x={x - 6}
            y={y - 20 - i * 12}
            width={12}
            height={10}
            fill="none"
            stroke={issueInk("multi-root")}
            strokeWidth={1.5}
          />
          <text x={x + 9} y={y - 15 - i * 12} fill={issueInk("multi-root")}>
            {`another root: equipment ${root.equipment} port ${root.port}`}
          </text>
        </g>
      ))}
    </g>
  );
}
