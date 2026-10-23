import { SvgTip } from "@pe/kit/lang/tooltip";
/**
 * The model picture's annotation layer: real DOM over the meshes, re-projected every frame the
 * camera moves (`Scene3D.onProject`, or a fit with no meshes). Labels, numbered finding marks, the
 * selection halo and, behind `centrelines` (off by default), the centreline strokes and nodes. The
 * SVG lets the pointer through to the canvas; only its hit targets take it. Every hit target that
 * stands for an element declares the displayed observation's member, so right-click and BX answer.
 */
import { useContext, useMemo } from "react";

import { revitTarget } from "@pe/kit/lang/revit-target";
import { token } from "@pe/kit/lib/token";
import type { DuctFinding } from "@pe/agent-contracts";
import { observedElements, useNativeObservation } from "#/revit/observation";
import type { IssueTarget } from "#/scene/types";
import type { StageIssue } from "./inbox-rows";
import type { Project, Size } from "#/scene/projection";

import {
  claimInk,
  DASH_CLASS,
  issueInk,
  nodeInk,
  strokeOf,
  type DuctNode,
  type Encoding,
  type Issue,
} from "./encoding";
import type { Claim } from "./legs";
import type { Scene } from "./scene";
import { Caption, pathOf, SubjectLabels } from "./subject-labels";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { useSubjectLighting } from "@pe/kit/lang/subject-text";

export type Ruling =
  | { kind: "claim"; n: number; at: number; claim: Claim }
  | { kind: "inferred"; n: number; at: number; finding: DuctFinding }
  | { kind: "issue"; n: number; at: number; issue: Issue };

/** A label at a model point: a leg's total, or a terminal's path total. */
export type Label = { key: string; at: readonly number[]; text: string; priced: boolean };

type Point = { x: number; y: number };

const GLYPH = 4;
const PIN = 8;
/** A footnote chip's diameter: the kit's `.subject-badge` circle. */
const CHIP = 18;
/** Where a chip may sit around its element, nearest and most legible first: above, the upper
 * diagonals, the sides, then below; then the same ring further out. */
const RING = [
  [0, -1],
  [0.72, -0.72],
  [-0.72, -0.72],
  [1, 0],
  [-1, 0],
  [0.72, 0.72],
  [-0.72, 0.72],
  [0, 1],
] as const;

/** Chip centres for numbered anchors: each takes the first ring slot that stays inside the picture
 * and clears every chip already placed and every anchor dot, so close connectors keep legible
 * numbers with a leader each. Order is the anchors' order (footnote order). */
export function placeChips(
  anchors: readonly { x: number; y: number; n: number }[],
  size: { width: number; height: number },
): { x: number; y: number }[] {
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const taken: Box[] = anchors.map((a) => ({ x0: a.x - 4, y0: a.y - 4, x1: a.x + 4, y1: a.y + 4 }));
  const clear = (b: Box) =>
    !taken.some((t) => b.x0 < t.x1 && t.x0 < b.x1 && b.y0 < t.y1 && t.y0 < b.y1);
  return anchors.map((a) => {
    const w = CHIP + 4;
    const h = CHIP + 4;
    let first: { x: number; y: number } | null = null;
    for (const r of [24, 40, 58])
      for (const [dx, dy] of RING) {
        const x = a.x + dx * (r + (dx ? w / 2 - h / 2 : 0));
        const y = a.y + dy * r;
        const box = { x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 };
        if (box.x0 < 0 || box.y0 < 0 || box.x1 > size.width || box.y1 > size.height) continue;
        first ??= { x, y };
        if (!clear(box)) continue;
        taken.push(box);
        return { x, y };
      }
    return first ?? { x: a.x, y: a.y - 24 };
  });
}
const HIT: React.CSSProperties = { pointerEvents: "auto", cursor: "pointer" };

/** Each node kind's glyph, centred on 0,0 in screen px. */
function Glyph({ kind, ink }: { kind: DuctNode["kind"]; ink: string }) {
  const g = GLYPH;
  switch (kind) {
    case "equipment":
      return <rect x={-g * 1.5} y={-g * 1.5} width={g * 3} height={g * 3} fill={ink} />;
    case "terminal":
      return <path d={`M0 ${-g * 1.4}L${g * 1.3} ${g}L${-g * 1.3} ${g}Z`} fill={ink} />;
    case "cap":
      return (
        <path d={`M${-g} ${-g}L${g} ${g}M${g} ${-g}L${-g} ${g}`} stroke={ink} strokeWidth={2} />
      );
    case "accessory":
      return (
        <path d={`M0 ${-g}L${g} 0L0 ${g}L${-g} 0Z`} fill="none" stroke={ink} strokeWidth={1.5} />
      );
    default:
      return <circle r={g * 0.5} fill={ink} />;
  }
}

export function Annotations({
  project,
  size,
  scene,
  layers,
  encoding,
  selected,
  hovered,
  labels,
  meshed,
  issues = [],
  onIssueHover,
  rulings,
  pointOf,
  issue,
  onPick,
  onFrame,
  onRuling,
  onHover,
}: {
  project: Project;
  size: Size;
  scene: Scene;
  layers: ReadonlySet<string>;
  encoding: Encoding;
  selected: ReadonlySet<number>;
  hovered: number | null;
  labels: readonly Label[];
  /** Element ids drawn as meshes right now; a footnote on any other element draws its centreline
   * as a ghost, or no badge when the picture does not hold the element at all. */
  meshed?: ReadonlySet<number>;
  issues?: readonly StageIssue[];
  onIssueHover?: (target: IssueTarget | null) => void;
  rulings: readonly Ruling[];
  /** A model point for an element: a node's point, or a segment's middle vertex. */
  pointOf: (id: number) => readonly number[] | null;
  /** The selected issue id; its mark draws heavier. */
  issue: string;
  onPick: (id: number, at: Point) => void;
  onFrame: (id: number) => void;
  onRuling: (r: Ruling, at: Point) => void;
  onHover: (id: number | null) => void;
}) {
  const observation = useNativeObservation();
  const subjects = useContext(SubjectTextContext);
  const lighting = useSubjectLighting();
  const target = (id: number) => {
    const t = observedElements(observation, [id]);
    return revitTarget(t.ids, t.refs);
  };
  const at = (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY });
  const element = (id: number) => ({
    ...target(id),
    style: HIT,
    onMouseEnter: () => onHover(id),
    onMouseLeave: () => onHover(null),
    onClick: (e: React.MouseEvent) => {
      if (e.detail < 2) onPick(id, at(e));
    },
    onDoubleClick: () => onFrame(id),
  });
  // The heavy strings rebuild per projection, never per hover.
  const lines = useMemo(
    () =>
      scene.segments.map((facts) => ({
        facts,
        d: pathOf(facts.segment.polyline, project),
        stroke: strokeOf(encoding, facts),
      })),
    [scene, project, encoding],
  );
  const halo = (id: number) =>
    selected.has(id)
      ? token("select")
      : id === hovered || lighting.ids.has(id)
        ? token("veil")
        : null;
  const sub = scene.subject;
  const taken = new Map<number, number>();
  // Footnote chips are placed together so each can clear the others. A badge sits on a drawn
  // subject: its mesh, else its centreline drawn as a ghost; never on empty space.
  const sceneSegments = new Map(scene.segments.map((f) => [f.segment.id, f.segment.polyline]));
  const sceneNodes = new Set(scene.nodes.map((f) => f.node.id));
  const anchored = lighting.references.flatMap((ref) => {
    const drawn = meshed?.has(ref.id) || layers.has("centrelines");
    const ghost = drawn ? null : sceneSegments.get(ref.id);
    if (!drawn && !ghost && !sceneNodes.has(ref.id)) return [];
    const p = pointOf(ref.id);
    const xy = p && project(p);
    return xy
      ? [{ ref, at: { x: xy[0], y: xy[1] }, ghost: ghost ? pathOf(ghost, project) : null, drawn }]
      : [];
  });
  const chips = placeChips(
    anchored.map(({ ref, at }) => ({ ...at, n: ref.number })),
    size,
  ).map((chip, i) => ({ ...anchored[i]!, chip }));

  return (
    <svg
      width={size.width}
      height={size.height}
      aria-label="annotations"
      data-ducts-annotations=""
      className="absolute left-0 top-0"
      style={{ pointerEvents: "none" }}
    >
      {lines.map(({ facts, d, stroke }) => {
        const id = facts.segment.id;
        const back = halo(id);
        if (!d || (!back && !layers.has("centrelines"))) return null;
        return (
          <g key={id} data-segment={id} data-selected={selected.has(id) ? "" : undefined}>
            {back ? (
              <path
                d={d}
                fill="none"
                stroke={back}
                strokeOpacity={0.7}
                strokeWidth={stroke.width + 8}
                strokeLinecap="round"
              />
            ) : null}
            {layers.has("centrelines") ? (
              <>
                <path
                  d={d}
                  fill="none"
                  stroke={stroke.ink}
                  // The only geometry an element has (no mesh drawn) must read, not be a hairline.
                  strokeWidth={meshed?.has(id) ? stroke.width : Math.max(stroke.width, 3)}
                  strokeLinecap="round"
                  className={stroke.dash ? DASH_CLASS[stroke.dash] : undefined}
                />
                <path d={d} fill="none" stroke="transparent" strokeWidth={12} {...element(id)} />
              </>
            ) : null}
          </g>
        );
      })}
      {scene.nodes.map((facts) => {
        const id = facts.node.id;
        const back = halo(id);
        const xy = project(facts.node.point);
        if (!xy || (!back && !layers.has("centrelines"))) return null;
        const ink = encoding.nodes
          ? strokeOf(encoding, facts).ink
          : nodeInk(encoding, facts.issues);
        return (
          <g
            key={id}
            data-node={facts.node.kind}
            data-node-id={id}
            data-selected={selected.has(id) ? "" : undefined}
            transform={`translate(${xy[0]} ${xy[1]})`}
          >
            {back ? <circle r={GLYPH * 2.5} fill={back} fillOpacity={0.7} /> : null}
            {layers.has("centrelines") ? (
              <g {...element(id)}>
                <circle r={GLYPH * 2.5} fill="transparent" />
                <Glyph kind={facts.node.kind} ink={ink} />
              </g>
            ) : null}
          </g>
        );
      })}
      {layers.has("labels") && sub ? <SubjectLabels sub={sub} project={project} /> : null}
      {layers.has("labels")
        ? placeLabels(labels, project).map(({ key, x, y, text, priced }) => (
            <g key={key} data-loss-label={text}>
              <Caption x={x} y={y} ink={priced ? token("ink") : token("ink-2")}>
                {text}
              </Caption>
            </g>
          ))
        : null}
      {layers.has("findings")
        ? rulings.map((r) => {
            const p = pointOf(r.at);
            const xy = p && project(p);
            if (!xy) return null;
            // Pins on one element step right by one pin.
            const slot = taken.get(r.at) ?? 0;
            taken.set(r.at, slot + 1);
            const ink =
              r.kind === "claim"
                ? claimInk(r.claim)
                : r.kind === "issue"
                  ? issueInk(r.issue)
                  : token("caution");
            const on = r.kind === "issue" && r.issue.id === issue;
            const finding =
              r.kind === "claim"
                ? `claim:${r.claim.id}`
                : r.kind === "issue"
                  ? r.issue.id
                  : r.finding.id;
            const target = {
              key: issues.find((i) => i.findings.includes(finding))?.key ?? finding,
              elementId: r.at,
            };
            return (
              <g
                key={r.n}
                data-ruling-pin={r.n}
                data-ruling-kind={r.kind}
                transform={`translate(${xy[0] + slot * PIN * 2.2} ${xy[1] - PIN * 2.4})`}
                style={HIT}
                onMouseEnter={() => onIssueHover?.(target)}
                onMouseLeave={() => onIssueHover?.(null)}
                onClick={(e) => onRuling(r, at(e))}
                onDoubleClick={() => onFrame(r.at)}
              >
                {r.kind === "claim" ? (
                  <circle r={PIN} fill={ink} stroke={token(on ? "ink" : "page")} />
                ) : (
                  <rect
                    x={-PIN}
                    y={-PIN}
                    width={PIN * 2}
                    height={PIN * 2}
                    fill={ink}
                    stroke={token(on ? "ink" : "page")}
                    strokeWidth={on ? 2.5 : 1}
                  />
                )}
                <text dy="0.35em" textAnchor="middle" fontSize={10} fill={token("page")}>
                  {r.n}
                </text>
              </g>
            );
          })
        : null}
      {chips.map(({ ref, at, chip, ghost, drawn }) => {
        const active = lighting.focus == null || lighting.focus === ref.id;
        return (
          <g
            key={ref.id}
            data-subject-badge={ref.id}
            data-footnote={ref.number}
            data-emphasized={active}
            opacity={active ? 1 : 0.35}
          >
            {ghost ? (
              <path
                d={ghost}
                fill="none"
                stroke={token("ink-2")}
                strokeWidth={3}
                strokeLinecap="round"
                className={DASH_CLASS.reference}
              />
            ) : !drawn ? (
              <circle
                cx={at.x}
                cy={at.y}
                r={6}
                fill="none"
                stroke={token("ink-2")}
                strokeWidth={2}
              />
            ) : null}
            {/* The leader: a cased ink line from the chip to a dot on the element. */}
            <line
              x1={chip.x}
              y1={chip.y}
              x2={at.x}
              y2={at.y}
              stroke={token("page")}
              strokeOpacity={0.75}
              strokeWidth={3.5}
            />
            <line
              x1={chip.x}
              y1={chip.y}
              x2={at.x}
              y2={at.y}
              stroke={token("ink")}
              strokeWidth={1.25}
            />
            <circle
              cx={at.x}
              cy={at.y}
              r={2.75}
              fill={token("ink")}
              stroke={token("page")}
              strokeWidth={1.5}
            />
            {/* The kit's subject mark: the same chip the text draws after the name, lit together.
                Hover lights its token in the text; a press goes to the subject, as the token does. */}
            <g
              className="subject-badge"
              data-lit={lighting.focus === ref.id ? "" : undefined}
              transform={`translate(${chip.x} ${chip.y})`}
              style={HIT}
              onMouseEnter={() => subjects?.light?.(lighting.references, ref.id, lighting.owner)}
              onMouseLeave={() => {
                subjects?.light?.(lighting.references, null, lighting.owner);
                if (lighting.owner) subjects?.clear?.(lighting.owner);
              }}
              onClick={() => subjects?.go?.(ref.id)}
            >
              <SvgTip content={"? go"} />
              <circle r={CHIP / 2} />
              <text y={3.5} textAnchor="middle">
                {ref.number}
              </text>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

/** Loss labels in screen px: the same words at the same place draw once (a leg total and a path
 * total can coincide), and a label that would overprint another steps down a line. */
export function placeLabels(labels: readonly Label[], project: Project) {
  const placed: { key: string; x: number; y: number; text: string; priced: boolean }[] = [];
  for (const { key, at, text, priced } of labels) {
    const xy = project(at);
    if (!xy) continue;
    const x = xy[0] + 8;
    let y = xy[1] + 14;
    const near = (p: { x: number; y: number }) =>
      Math.abs(p.x - x) < 6 * text.length && Math.abs(p.y - y) < 12;
    if (placed.some((p) => p.text === text && near(p))) continue;
    while (placed.some(near)) y += 12;
    placed.push({ key, x, y, text, priced });
  }
  return placed;
}
