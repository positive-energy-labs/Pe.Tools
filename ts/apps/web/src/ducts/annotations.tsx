/**
 * The model picture's annotation layer: real DOM over the meshes, re-projected every frame the
 * camera moves (`Scene3D.onProject`, or a fit with no meshes). Labels, numbered finding marks, the
 * selection halo and, behind `centrelines` (off by default), the centreline strokes and nodes. The
 * SVG lets the pointer through to the canvas; only its hit targets take it. Every hit target that
 * stands for an element declares the displayed observation's member, so right-click and BX answer.
 */
import { useMemo } from "react";

import { revitTarget } from "@pe/kit/lang/row";
import { token } from "@pe/kit/lib/token";
import type { DuctFinding } from "@pe/agent-contracts";
import type { NoRunBranch } from "@pe/ducts-domain/no-runs";
import { observedElements, useNativeObservation } from "#/revit/observation";
import type { IssueTarget } from "#/scene/types";
import { issueAt, type StageIssue } from "./inbox-rows";
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

export type Ruling =
  | { kind: "claim"; n: number; at: number; claim: Claim }
  | { kind: "inferred"; n: number; at: number; finding: DuctFinding }
  | { kind: "issue"; n: number; at: number; issue: Issue };

/** A label at a model point: a leg's total, or a terminal's path total. */
export type Label = { key: string; at: readonly number[]; text: string; priced: boolean };

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
  noRuns,
  issues = [],
  hoveredIssue,
  onIssueHover,
  onIssuePick,
  rulings,
  pointOf,
  issue,
  onPick,
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
  noRuns?: ReadonlyMap<number, NoRunBranch>;
  issues?: readonly StageIssue[];
  hoveredIssue?: string | null;
  onIssueHover?: (target: IssueTarget | null) => void;
  onIssuePick?: (target: IssueTarget) => void;
  rulings: readonly Ruling[];
  /** A model point for an element: a node's point, or a segment's middle vertex. */
  pointOf: (id: number) => readonly number[] | null;
  /** The selected issue id; its mark draws heavier. */
  issue: string;
  onPick: (id: number, at: Point) => void;
  onRuling: (r: Ruling, at: Point) => void;
  onHover: (id: number | null) => void;
}) {
  const observation = useNativeObservation();
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
    onClick: (e: React.MouseEvent) => onPick(id, at(e)),
  });
  const branchIssue = (branch: NoRunBranch) =>
    issueAt(
      issues,
      branch.reasons.map((r) => r.at),
      hoveredIssue ?? issue,
    ) ?? issueAt(issues, branch.elements, hoveredIssue ?? issue);
  const noRunTarget = (id: number, branch: NoRunBranch) => {
    const row = branchIssue(branch);
    if (!row) return element(id);
    const target = { key: row.key, elementId: id };
    return {
      ...element(id),
      "data-stage-issue": row.key,
      onMouseEnter: () => onIssueHover?.(target),
      onMouseLeave: () => onIssueHover?.(null),
      onClick: () => onIssuePick?.(target),
    };
  };
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
    selected.has(id) ? token("select") : id === hovered ? token("veil") : null;
  const sub = scene.subject;
  const taken = new Map<number, number>();

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
        const noRun = layers.has("no-run") ? noRuns?.get(id) : null;
        if (!d || (!back && !noRun && !layers.has("centrelines"))) return null;
        return (
          <g key={id} data-segment={id} data-selected={selected.has(id) ? "" : undefined}>
            {noRun ? (
              <path
                d={d}
                fill="none"
                stroke={token("viz-3")}
                strokeWidth={branchIssue(noRun)?.key === hoveredIssue ? 8 : 5}
                strokeLinecap="round"
                {...noRunTarget(id, noRun)}
              >
                <title>No run: {noRun.reasons.map((r) => r.text).join("; ")}</title>
              </path>
            ) : null}
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
                  strokeWidth={stroke.width}
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
        const noRun = layers.has("no-run") ? noRuns?.get(id) : null;
        if (!xy || (!back && !noRun && !layers.has("centrelines"))) return null;
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
            {noRun ? (
              <g {...noRunTarget(id, noRun)}>
                <title>No run: {noRun.reasons.map((r) => r.text).join("; ")}</title>
                <circle r={GLYPH} fill={token("viz-3")} />
              </g>
            ) : null}
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
        ? labels.map(({ key, at: p, text, priced }) => {
            const xy = project(p);
            return xy ? (
              <g key={key} transform={`translate(${xy[0]} ${xy[1]})`} data-loss-label={text}>
                <Caption x={8} y={14} ink={priced ? token("ink") : token("ink-2")}>
                  {text}
                </Caption>
              </g>
            ) : null;
          })
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
    </svg>
  );
}
