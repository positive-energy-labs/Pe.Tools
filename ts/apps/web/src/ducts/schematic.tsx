import type { Tone } from "@pe/kit/lib/token";
import { nameOrFallback } from "@pe/kit/lang/subject-text";
import { SvgTip } from "@pe/kit/lang/tooltip";
import type { IssueKind } from "@pe/ducts-domain/issues";
/**
 * The group as a one-line schematic, fan at the left, registers at the right: the same picture as
 * the model, drawn as a tree. Straight runs fold into one edge labelled size, developed length and
 * pass-1 cfm; selecting an edge unfolds it. Edges are inked by the drawing's encoding, so a reading
 * (health, velocity, ...) means the same here as on the model. Selection and the hover-lit set come
 * from the caller, so both pictures light together. One component, two slots: `main` is the whole
 * picture (labelled, pans and zooms), `inset` is the corner (no labels, fits its box).
 *
 * The layout is a tidy tree: each vertex's first child continues its row (the longest run first,
 * so it reads straight along the top) and later children hang below.
 */
import { useMemo, type ReactNode } from "react";

import { tokenRef } from "@pe/kit/lib/token";
import {
  chainsOf,
  groupTree,
  terminalCfm,
  type Chain,
  type GroupTree,
} from "@pe/ducts-domain/topology";

import { PanZoom } from "#/scene/pan-zoom";
import { DASH_CLASS, strokeOf, type Encoding, type EncodingFacts } from "./encoding";
import { ISSUE_KINDS } from "./issues";
import { sceneOf, type DuctIndex } from "./scene";

const COL = 168;
const ROW = 40;
const PAD = 24;
const ROOT_W = 132;
/** Room right of the last vertex for its label. */
const LABEL_W = 340;
const INSET_LABEL_W = 24;

/** A tone's ink role: `mute` is the one tone with no role of its own name. */
const inkOf = (tone: Tone | undefined) => tokenRef(tone ?? "ink-mute");
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
function layoutTree(tree: GroupTree, chains: Chain[], labelW = LABEL_W): TreeLayout {
  const below = new Map<number | null, Chain[]>();
  for (const chain of chains) below.set(chain.from, [...(below.get(chain.from) ?? []), chain]);
  // A subtree's reach: its farthest terminal first (so the critical-path stand-in runs along the
  // top row), then its farthest leaf of any kind (open ends and caps have no terminal).
  const reach = new Map<number, [number, number]>();
  const farthest = (chain: Chain): [number, number] => {
    const known = reach.get(chain.to);
    if (known) return known;
    const kids = (below.get(chain.to) ?? []).map(farthest);
    const own = tree.dist.get(chain.to)!;
    const terminal = tree.parts.get(chain.to)!.node?.kind === "terminal" ? own : -1;
    const value: [number, number] = [
      Math.max(terminal, ...kids.map((k) => k[0])),
      Math.max(own, ...kids.map((k) => k[1])),
    ];
    reach.set(chain.to, value);
    return value;
  };
  const ordered = (from: number | null) =>
    [...(below.get(from) ?? [])].sort((a, b) => {
      const [ra, rb] = [farthest(a), farthest(b)];
      return rb[0] - ra[0] || rb[1] - ra[1] || a.to - b.to;
    });

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
    width: ROOT_W + deepest * COL + labelW,
    height: PAD * 2 + Math.max(slot - 1, 0) * ROW + 24,
  };
}

const fmt = (value: number, digits = 0) => value.toFixed(digits);
const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export interface SchematicProps {
  readout: ReactNode;
  index: DuctIndex;
  /** The group to draw; empty draws the invitation to choose one. */
  group: string;
  /** The model's encoding: an edge wears the stroke of its first segment under it. */
  encoding: Encoding;
  /** Element ids selected; an edge holding one is ringed, and a fold holding one unfolds. */
  selected: ReadonlySet<number>;
  /** Element ids lit by a hover anywhere (a row, the model, a claim); drawn heavy. */
  lit: ReadonlySet<number>;
  onSelect: (id: number | null) => void;
  onHover: (id: number | null) => void;
  /** `main` is the whole picture; `inset` the corner, unlabelled, scaled to its box. */
  size?: "main" | "inset";
}

const SELECT_WIDTH = 8;

export function Schematic({
  readout,
  index,
  group,
  encoding,
  selected,
  lit,
  onSelect,
  onHover,
  size = "main",
}: SchematicProps) {
  const inset = size === "inset";
  const { snapshot } = index;
  const tree = useMemo(() => (group ? groupTree(snapshot, group) : null), [snapshot, group]);
  const facts = useMemo(() => {
    const out = new Map<number, EncodingFacts>();
    if (!group) return out;
    const scene = sceneOf(index, [group], () => true);
    for (const f of scene.segments) out.set(f.segment.id, f);
    return out;
  }, [index, group]);
  // The chain a selected fold member sits in unfolds: its members become vertices.
  const base = useMemo(() => (tree ? chainsOf(tree) : []), [tree]);
  const unfold = useMemo(() => {
    const hit = base.find((c) => c.members.slice(0, -1).some((id) => selected.has(id)));
    return new Set(hit?.members ?? []);
  }, [base, selected]);
  const chains = useMemo(() => (tree ? chainsOf(tree, unfold) : []), [tree, unfold]);
  const layout = useMemo(
    () => (tree ? layoutTree(tree, chains, inset ? INSET_LABEL_W : LABEL_W) : null),
    [tree, chains, inset],
  );

  if (!tree || !layout)
    return (
      <>
        {readout}
        <p className="text-ink-2 t-small p-3" data-schematic="empty">
          {group ? "this network has no tree to draw" : "choose a system to see its schematic"}
        </p>
      </>
    );

  const pick = (id: number) => onSelect(selected.has(id) ? null : id);
  const equipment = snapshot.nodes.find((n) => n.id === tree.root?.equipment);
  const rootY = layout.placed.find((p) => p.chain.from === null)?.y1 ?? PAD;
  const litHas = (ids: readonly number[]) => ids.some((id) => lit.has(id));

  const svg = (
    <svg
      role="img"
      aria-label="duct tree"
      data-schematic={size}
      width={inset ? "100%" : layout.width}
      height={inset ? "100%" : layout.height}
      viewBox={inset ? `0 0 ${layout.width} ${layout.height}` : undefined}
      preserveAspectRatio={inset ? "xMinYMid meet" : undefined}
      className="face-mono t-small"
    >
      <g
        onClick={() => tree.root && pick(tree.root.element)}
        className="cursor-pointer"
        aria-label="root"
      >
        <SvgTip content={"root"} />
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
          {clip(equipment ? nameOrFallback(equipment.family) : "stand-in root", 16)}
        </text>
      </g>
      {layout.placed.map(({ chain, x1, y1, x2, y2 }) => {
        const bend = x1 + 10;
        const d = `M${x1} ${y1} H${bend} V${y2} H${x2}`;
        const hot = chain.members.some((id) => selected.has(id));
        const glow = litHas(chain.members);
        const lead = chain.members.map((id) => facts.get(id)).find((f) => f != null);
        const stroke = lead ? strokeOf(encoding, lead) : null;
        const width = Math.max(1.5, Math.min(stroke?.width ?? 1.5, 8));
        const issues = chain.members
          .flatMap((id) => tree.issuesByElement.get(id) ?? [])
          .filter((i) => i.kind !== "open-end");
        const kinds = [...new Set(issues.map((i) => i.kind))];
        const labelX = bend + 6;
        return (
          <g
            key={chain.to}
            data-element={chain.members[0]}
            data-selected={hot ? "" : undefined}
            data-lit={glow ? "" : undefined}
            className="cursor-pointer"
            onClick={() => pick(chain.members[0]!)}
            onPointerEnter={() => onHover(chain.members[0]!)}
            onPointerLeave={() => onHover(null)}
          >
            <SvgTip content={"chain"} />
            {hot ? (
              <path
                d={d}
                fill="none"
                stroke={tokenRef("select")}
                strokeWidth={width + SELECT_WIDTH}
              />
            ) : null}
            {glow ? (
              <path
                d={d}
                fill="none"
                stroke={tokenRef("ink")}
                strokeOpacity={0.35}
                strokeWidth={width + 6}
              />
            ) : null}
            <path
              d={d}
              fill="none"
              stroke={stroke?.ink ?? tokenRef("ink-mute")}
              strokeWidth={width}
              className={stroke?.dash ? DASH_CLASS[stroke.dash] : undefined}
            />
            {inset ? null : (
              <>
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
              </>
            )}
            {kinds.map((kind, i) => (
              <circle key={kind} cx={x2 - 8 - i * 9} cy={y2 + 9} r={3.5} fill={issueInk(kind)}>
                <SvgTip content={ISSUE_KINDS[kind].label} />
              </circle>
            ))}
            <Vertex
              tree={tree}
              id={chain.to}
              x={x2}
              y={y2}
              hot={selected.has(chain.to)}
              glow={lit.has(chain.to)}
              far={tree.longest.at(-1) === chain.to}
              labelled={!inset}
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
            <SvgTip content={ISSUE_KINDS.loop.label} />
          </path>
        );
      })}
    </svg>
  );
  return inset ? (
    <div className="size-full" data-schematic-slot="inset">
      {svg}
    </div>
  ) : (
    <div className="size-full min-h-0" data-schematic-slot="main">
      <PanZoom readout={readout} content={{ width: layout.width, height: layout.height }}>
        {svg}
      </PanZoom>
    </div>
  );
}

/** A vertex's mark: terminal square with design cfm, cap bar, branch dot, open end, extra root. */
function Vertex({
  tree,
  id,
  x,
  y,
  hot,
  glow,
  far,
  labelled,
}: {
  tree: GroupTree;
  id: number;
  x: number;
  y: number;
  hot: boolean;
  glow: boolean;
  far: boolean;
  labelled: boolean;
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
      <SvgTip content={kind ?? "part"} />
      {hot ? <circle cx={x} cy={y} r={9} fill={tokenRef("select")} /> : null}
      {glow && !hot ? (
        <circle cx={x} cy={y} r={8} fill={tokenRef("ink")} fillOpacity={0.35} />
      ) : null}
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
      {label && labelled ? (
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
          {labelled ? (
            <text x={x + 24} y={y + 14 + i * 8} fill={issueInk("open-end")}>
              {ISSUE_KINDS["open-end"].label}
            </text>
          ) : null}
          <SvgTip content={"open end"} />
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
          {labelled ? (
            <text x={x + 9} y={y - 15 - i * 12} fill={issueInk("multi-root")}>
              {`another root: equipment ${root.equipment} port ${root.port}`}
            </text>
          ) : null}
        </g>
      ))}
    </g>
  );
}
