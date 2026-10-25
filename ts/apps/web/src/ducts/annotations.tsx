import { declutter } from "@pe/kit/lang/declutter";
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
import { pathOf, SubjectLabels } from "./subject-labels";
import { reachProps, SubjectTextContext } from "@pe/kit/lang/reach";
import { Footnotes, useFootnotes, type FootnoteProject } from "#/scene/footnotes";
import { useElementAttention } from "#/attention";
import { elementKey, useMention } from "@pe/kit/lang/attention";

export type Ruling =
  | { kind: "claim"; n: number; at: number; claim: Claim }
  | { kind: "inferred"; n: number; at: number; finding: DuctFinding }
  | { kind: "issue"; n: number; at: number; issue: Issue };

/** A label at a model point: a leg's total, or a terminal's path total. */
export type Label = {
  key: string;
  at: readonly number[];
  text: string;
  priced: boolean;
  ids: readonly number[];
  /** A neighbouring system's name, independently toggled by `stub-labels`. */
  stub?: boolean;
};

type Point = { x: number; y: number };

const GLYPH = 4;
const PIN = 8;
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
  rulings,
  pointOf,
  issue,
  onPick,
  onFrame,
  onRuling,
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
  rulings: readonly Ruling[];
  /** A model point for an element: a node's point, or a segment's middle vertex. */
  pointOf: (id: number) => readonly number[] | null;
  /** The selected issue id; its mark draws heavier. */
  issue: string;
  onPick: (id: number, at: Point) => void;
  onFrame: (id: number) => void;
  onRuling: (r: Ruling, at: Point) => void;
}) {
  const observation = useNativeObservation();
  const subjects = useContext(SubjectTextContext);
  const { lit, citation } = useElementAttention();
  const focus = citation?.focus?.key.startsWith("e:") ? Number(citation.focus.key.slice(2)) : null;
  const mark = useMention();
  const target = (id: number) => {
    const t = observedElements(observation, [id]);
    return revitTarget(t.ids, t.refs);
  };
  const at = (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY });
  const element = (id: number) => ({
    ...target(id),
    ...mark(elementKey(id)),
    style: HIT,
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
    selected.has(id) ? token("select") : id === hovered || lit.has(id) ? token("veil") : null;
  const sub = scene.subject;

  // Footnote chips are placed together so each can clear the others. A badge sits on a drawn
  // subject: its mesh, else its centreline drawn as a ghost; never on empty space.
  const sceneSegments = new Map(scene.segments.map((f) => [f.segment.id, f.segment.polyline]));
  const sceneNodes = new Set(scene.nodes.map((f) => f.node.id));
  const footnoteProject: FootnoteProject = (ref) => {
    if (!ref.key.startsWith("e:")) return null;
    const id = Number(ref.key.slice(2));
    const drawn = !!meshed?.has(id) || layers.has("centrelines");
    const ghost = drawn ? null : sceneSegments.get(id);
    if (!drawn && !ghost && !sceneNodes.has(id)) return null;
    const p = pointOf(id);
    const xy = p && project(p);
    return xy
      ? { at: { x: xy[0], y: xy[1] }, ghost: ghost ? pathOf(ghost, project) : null, drawn }
      : null;
  };
  const bounds = { x: 0, y: 0, ...size };
  const pins = declutter(
    (layers.has("findings") ? rulings : []).flatMap((r) => {
      const p = pointOf(r.at),
        xy = p && project(p);
      if (!xy) return [];
      return [
        {
          x: xy[0] - PIN,
          y: xy[1] - PIN * 3.4,
          width: PIN * 2,
          height: PIN * 2,
          value: r,
        },
      ];
    }),
    bounds,
  );
  const { chips } = useFootnotes(footnoteProject, size, pins);
  const obstacles = [...chips.map((c) => c.box), ...pins];

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
      {layers.has("labels") || layers.has("stub-labels") ? (
        <SubjectLabels
          sub={layers.has("labels") ? sub : undefined}
          project={project}
          bounds={bounds}
          obstacles={obstacles}
          hovered={focus ?? hovered}
          extra={labels
            .filter((label) => layers.has(label.stub ? "stub-labels" : "labels"))
            .flatMap((label) => {
              const xy = project(label.at);
              return xy ? [{ ...label, x: xy[0] + 8, y: xy[1] + 14 }] : [];
            })}
        />
      ) : null}
      {layers.has("findings")
        ? pins.map(({ value: r, x, y }) => {
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
            const issueTarget = {
              key: issues.find((i) => i.findings.includes(finding))?.key ?? finding,
              elementId: r.at,
            };
            return (
              <g
                key={`${r.n}:${r.at}`}
                data-ruling-pin={r.n}
                data-ruling-kind={r.kind}
                transform={`translate(${x + PIN} ${y + PIN})`}
                {...target(r.at)}
                {...reachProps()}
                style={HIT}
                tabIndex={0}
                aria-label={`finding ${r.n}`}
                {...mark(`issue:${issueTarget.key}`)}
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
      <Footnotes
        project={footnoteProject}
        size={size}
        obstacles={pins}
        onGo={(ref) => subjects?.go?.(Number(ref.key.slice(2)))}
      />
    </svg>
  );
}
