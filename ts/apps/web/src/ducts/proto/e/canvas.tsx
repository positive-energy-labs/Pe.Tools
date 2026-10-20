/**
 * proto: copied from proto/c/canvas.tsx (round 2, E1/E2 centre). Changes: `lit` lights a sidebar
 * row's element set (drawn as the drawing's `critical` underlay), and issue pins are scoped by the
 * group's `issueIds`. Original note follows.
 *
 * THROWAWAY (protoui round 1, variant C "canvas only"): the iso drawing is the whole screen. Loss
 * labels and ruling pins ride DuctDrawing's `underlay` slot, so they share its real camera
 * (drawing feet, counter-scaled to screen px from the visible box). Facts open in click-anchored
 * kit popovers. No sidebars, no tables.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { ArrowRightLeft } from "lucide-react";

import { Button } from "@pe/kit/lang/button";
import { useScopeKeys } from "@pe/kit/keys";
import { KeyLegend, type LegendKey } from "#/components/lang/kbd";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";
import { token } from "@pe/kit/lib/token";
import { INFERRED_KINDS } from "@pe/ducts-domain/proximity";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { survey } from "@pe/ducts-domain/survey";
import type { DuctFinding } from "@pe/agent-contracts";

import { ClaimText, claimParts, elementNamer, VERDICTS } from "../../claims";
import { DuctDrawing } from "../../drawing";
import { claimInk, issueInk, type Issue } from "../../encoding";
import { EncodingPicker } from "../encoding/picker";
import { ScaleLegend } from "../encoding/scale-legend";
import type { GroupEncoding } from "../encoding/use-encoding";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { FindingsList, ISSUE_KINDS } from "../../issues";
import { useIso } from "../../iso";
import { labelOfNode, legsOf, type Claim } from "../../legs";
import { cameraOf, pictureKeys, pictureOf } from "../../picture";
import { ProvisionalNote } from "../../provisional";
import { indexOf, subjectScene } from "../../scene";
import { Schematic } from "../../schematic";
import type { ProtoProps } from "../props";

type Ruling =
  | { kind: "claim"; n: number; at: number; claim: Claim }
  | { kind: "inferred"; n: number; at: number; finding: DuctFinding }
  | { kind: "issue"; n: number; at: number; issue: Issue };

type Open =
  | { what: "element"; id: number; x: number; y: number }
  | { what: "ruling"; n: number; x: number; y: number }
  | null;

const PIN = 8;
/** The corner picture: the other half of the swap, small. */
const CORNER = { width: 300, height: 176, margin: 8 } as const;

/** The canvas's keys: the orbit camera's gestures (`iso.tsx`, `orbit/lens.tsx`) and the tree's. */
const CANVAS_KEYS: readonly LegendKey[] = [
  { pointer: "drag", does: "orbit" },
  { keys: ["Shift"], pointer: "drag", does: "pan" },
  { pointer: "wheel", does: "zoom" },
  { keys: ["S"], does: "swap the model and the schematic" },
  { keys: ["P"], does: "plan or isometric camera" },
  { keys: ["F"], does: "frame the selection" },
  { pointer: "double-click", does: "select and frame" },
  { keys: ["Esc"], does: "clear the selection" },
  { keys: ["↑", "↓", "←", "→"], does: "walk the tree in the sidebar" },
];
const fmt = (n: number | null | undefined, d = 3) => (n == null ? "—" : n.toFixed(d));

/** Cumulative loss from the fan to each element, walked along priced paths (critical path first). */
function cumulativeOf(priced: ProtoProps["priced"]): Map<number, number> {
  const out = new Map<number, number>();
  if (!priced) return out;
  const r = priced.now;
  const order = Object.entries(r.paths).sort(([a], [b]) =>
    Number(a) === r.critical ? -1 : Number(b) === r.critical ? 1 : 0,
  );
  for (const [, path] of order) {
    let run = 0;
    for (const row of path.rows) {
      run += row.dp ?? 0;
      if (!out.has(row.id) || out.get(row.id)! < run) out.set(row.id, run);
    }
  }
  return out;
}

export interface ECanvasExtra {
  /** The element set a sidebar row lights; empty lights nothing. */
  lit: ReadonlySet<number>;
  /** The group's issue ids; null = every issue on a drawn element. */
  issueScope: ReadonlySet<string> | null;
  /** The group's encoding: the screen owns it so the tree reads the same numbers. */
  scale: GroupEncoding;
}

export function ECanvas(props: ProtoProps & ECanvasExtra) {
  const { snapshot, priced, subject, work } = props;
  if (!snapshot)
    return (
      <p className="p-3 text-ink-2">
        {props.empty?.says ?? (props.reading.pending ? "reading ducts…" : "no snapshot")}
      </p>
    );
  return <Canvas {...props} snapshot={snapshot} priced={priced} subject={subject} work={work} />;
}

function Canvas({
  snapshot,
  priced,
  page,
  subject,
  claims,
  work,
  hovered,
  onHover,
  onSelect,
  doc,
  lit,
  issueScope,
  scale,
  setPage,
}: ProtoProps & ECanvasExtra & { snapshot: NonNullable<ProtoProps["snapshot"]> }) {
  const index = useMemo(() => indexOf(snapshot, priced), [snapshot, priced]);
  const labelOf = useMemo(() => labelOfNode(snapshot), [snapshot]);
  const drawnSubject = useMemo(
    () =>
      subject
        ? subjectScene(
            index,
            subject.ids,
            legsOf(snapshot, subject.ids, labelOf, subject.work ?? null),
            [], // pins are ours; the drawing draws none
          )
        : null,
    [index, snapshot, subject, labelOf],
  );
  const iso = useIso(index, page, drawnSubject);
  // `page.picture` is the main picture (the other rides the corner); `page.camera` a globe preset.
  const picture = pictureOf(page);
  const camera = cameraOf(page);
  const swap = () => setPage(pictureKeys({ picture: picture === "model" ? "schematic" : "model" }));
  const turnCamera = () => setPage(pictureKeys({ camera: camera === "plan" ? "iso" : "plan" }));
  useScopeKeys([
    {
      hotkey: "S",
      label: "swap pictures",
      says: "Swap the model and the schematic between the main picture and the corner",
      callback: swap,
    },
    {
      hotkey: "P",
      label: "plan or isometric",
      says: "Put the model's camera straight down (plan) or back to the isometric",
      available: () => picture === "model",
      callback: turnCamera,
    },
  ]);
  // The corner model is the same camera without its gestures: a fresh function the camera registry never saw.
  const cornerProject = useMemo(
    () => (point: readonly number[]) => iso.project(point),
    [iso.project],
  );
  // One hover set for both pictures: a sidebar row's set plus the element under the pointer.
  const litAll = useMemo(() => {
    const out = new Set(lit);
    if (hovered != null) out.add(hovered);
    return out;
  }, [lit, hovered]);
  const sub = iso.scene.subject ?? null;
  const byId = useMemo(() => snapshotById(snapshot), [snapshot]);
  const nameOfId = useMemo(() => elementNamer(snapshot, sub), [snapshot, sub]);
  const cumulative = useMemo(() => cumulativeOf(priced), [priced]);

  const host = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1);
  useEffect(() => {
    if (!host.current) return;
    const o = new ResizeObserver(([e]) => setWidth(e!.contentRect.width || 1));
    o.observe(host.current);
    return () => o.disconnect();
  }, []);
  const pointer = useRef({ x: 0, y: 0 });
  const [open, setOpen] = useState<Open>(null);

  const pointOf = (id: number): number[] | null => {
    const node = byId.nodes.get(id);
    if (node) return node.point;
    const line = byId.segments.get(id)?.polyline;
    return line ? (line[Math.floor((line.length - 1) / 2)] ?? null) : null;
  };

  // The drawn element ids: the subject's, else the group's.
  const drawn = useMemo(
    () =>
      new Set([
        ...iso.scene.segments.map((f) => f.segment.id),
        ...iso.scene.nodes.map((f) => f.node.id),
      ]),
    [iso.scene],
  );

  const rulings = useMemo<Ruling[]>(() => {
    const out: Ruling[] = [];
    for (const claim of claims)
      if (claim.at[0] != null) out.push({ kind: "claim", n: 0, at: claim.at[0], claim });
    const findings = (priced?.findings ?? survey(snapshot, work.doc).findings).filter(
      (f) => INFERRED_KINDS.has(f.kind) && f.elementIds.some((id) => drawn.has(id)),
    );
    for (const finding of findings)
      out.push({
        kind: "inferred",
        n: 0,
        at: finding.elementIds.find((id) => drawn.has(id))!,
        finding,
      });
    for (const issue of snapshot.issues)
      if (
        issue.elementId != null &&
        drawn.has(issue.elementId) &&
        (!issueScope || issueScope.has(issue.id))
      )
        out.push({ kind: "issue", n: 0, at: issue.elementId, issue });
    return out.map((r, i) => ({ ...r, n: i + 1 }));
  }, [claims, priced, snapshot, work.doc, drawn, issueScope]);

  // Header facts: a system name (never a group id), Pe fan static, critical run total.
  const firstId = subject?.ids[0] ?? iso.scene.segments[0]?.segment.id ?? null;
  const systemName =
    (page.group ? snapshot.groups.find((g) => g.id === page.group)?.systemNames[0] : null) ??
    (firstId == null
      ? null
      : (byId.segments.get(firstId)?.systemName ?? byId.nodes.get(firstId)?.systemName)) ??
    iso.scene.segments.find((f) => f.segment.systemName)?.segment.systemName ??
    null;
  const groupId =
    page.group ||
    (firstId == null
      ? ""
      : (byId.segments.get(firstId)?.groupId ?? byId.nodes.get(firstId)?.groupId ?? ""));
  const solved = groupId ? priced?.now.byGroup[groupId] : null;
  const criticalPath = solved?.critical != null ? priced?.now.paths[solved.critical] : null;
  const criticalName = solved?.critical != null ? nameOfId(solved.critical) : null;

  const selected = useMemo(() => {
    const id = page.selected && !claims.some((c) => c.id === page.selected) ? Number(page.selected) : null;
    if (id == null) return new Set<number>();
    const leg = sub?.legOf.get(id);
    return new Set(leg ? [id, ...leg.ids] : [id]);
  }, [page.selected, claims, sub]);

  const at = (e: { clientX: number; clientY: number }) => ({ x: e.clientX, y: e.clientY });
  /** Select, and open the element's facts where the pointer last went down: either picture's click. */
  const pickElement = (id: number | null) => {
    onSelect(id);
    setOpen(id == null ? null : { what: "element", id, ...pointer.current });
  };

  /** In drawing feet; `k` turns a screen px into drawing feet at the current zoom. */
  const underlay = (box: { minX: number; maxX: number }): ReactNode => {
    const k = (box.maxX - box.minX) / width;
    const legLabels = sub
      ? sub.cut.legs.flatMap((leg) => {
          const middle = leg.ids[Math.floor(leg.ids.length / 2)];
          const p = middle == null ? null : pointOf(middle);
          if (!p) return [];
          const end = [...leg.ids, leg.to.id].reverse().find((id) => cumulative.has(id));
          const text =
            end == null
              ? `${leg.name} · unpriced`
              : `Σ ${fmt(cumulative.get(end))} in-wg`;
          return [{ key: `${leg.name}|${leg.ids[0]}`, xy: iso.project(p), text, priced: end != null }];
        })
      : // A group scene has no legs: each terminal carries its path total.
        iso.scene.nodes.flatMap((f) => {
          if (f.node.kind !== "terminal") return [];
          const total = priced?.now.paths[f.node.id]?.total;
          return [
            {
              key: String(f.node.id),
              xy: iso.project(f.node.point),
              text: total == null ? "unpriced" : `Σ ${fmt(total)} in-wg`,
              priced: total != null,
            },
          ];
        });
    // Pins on one element step right by one pin, as the drawing's claim pins do.
    const taken = new Map<number, number>();
    const pins = rulings.flatMap((r) => {
      const p = pointOf(r.at);
      if (!p) return [];
      const slot = taken.get(r.at) ?? 0;
      taken.set(r.at, slot + 1);
      return [{ r, xy: iso.project(p), slot }];
    });
    return (
      <g data-proto-c-overlay="">
        {legLabels.map(({ key, xy, text, priced: isPriced }) => (
          <g key={key} transform={`translate(${xy[0]} ${xy[1]}) scale(${k})`} pointerEvents="none">
            <text
              x={8}
              y={14}
              fontSize={10}
              className="face-mono"
              fill={isPriced ? token("ink") : token("ink-2")}
              stroke={token("page")}
              strokeWidth={3}
              paintOrder="stroke"
              data-loss-label={text}
            >
              {text}
            </text>
          </g>
        ))}
        {pins.map(({ r, xy, slot }) => {
          const ink =
            r.kind === "claim"
              ? claimInk(r.claim)
              : r.kind === "issue"
                ? issueInk(r.issue)
                : token("caution");
          return (
            <g
              key={r.n}
              data-ruling-pin={r.n}
              data-ruling-kind={r.kind}
              transform={`translate(${xy[0]} ${xy[1]}) scale(${k}) translate(${slot * PIN * 2.2} ${-PIN * 2.4})`}
              style={{ cursor: "pointer" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(r.at);
                setOpen({ what: "ruling", n: r.n, ...at(e) });
              }}
            >
              {r.kind === "claim" ? (
                <circle r={PIN} fill={ink} stroke={token("page")} />
              ) : (
                <rect x={-PIN} y={-PIN} width={PIN * 2} height={PIN * 2} fill={ink} stroke={token("page")} />
              )}
              <text dy="0.35em" textAnchor="middle" fontSize={10} fontWeight={600} fill={token("page")} pointerEvents="none">
                {r.n}
              </text>
            </g>
          );
        })}
      </g>
    );
  };

  const openRuling = open?.what === "ruling" ? rulings.find((r) => r.n === open.n) : null;
  const elementId = open?.what === "element" ? open.id : null;
  const segFacts = elementId == null ? null : iso.scene.segments.find((f) => f.segment.id === elementId);
  const nodeFacts = elementId == null ? null : iso.scene.nodes.find((f) => f.node.id === elementId);
  const anchor = open
    ? { getBoundingClientRect: () => DOMRect.fromRect({ x: open.x, y: open.y, width: 0, height: 0 }) }
    : undefined;

  return (
    <div
      ref={host}
      data-proto="E"
      className="relative flex size-full min-h-0 flex-col"
      onPointerDownCapture={(e) => {
        pointer.current = at(e);
      }}
    >
      {picture === "model" ? (
      <DuctDrawing
        label={iso.label}
        project={iso.project}
        scene={iso.scene}
        encoding={scale.encoding}
        fitKey={iso.fitKey}
        selected={selected}
        // The set rides `critical` (a heavy ink underlay that draws on any projection); the orbit
        // agent's `lit` prop only acts under its run lens, which this iso canvas does not mount.
        critical={lit}
        hovered={hovered}
        issue={page.issue}
        claim=""
        onHover={onHover}
        onSelect={pickElement}
        onSelectIssue={(issue) => {
          const r = rulings.find((x) => x.kind === "issue" && x.issue.id === issue.id);
          if (r) setOpen({ what: "ruling", n: r.n, ...pointer.current });
        }}
        onDrag={iso.onDrag}
        underlay={underlay}
        controls={<EncodingPicker value={scale.encoding.key} onPick={(key) => setPage({ encoding: key })} />}
        cornerLift={CORNER.height + CORNER.margin}
      />
      ) : (
        <Schematic
          index={index}
          group={page.group}
          encoding={scale.encoding}
          selected={selected}
          lit={litAll}
          onSelect={pickElement}
          onHover={onHover}
        />
      )}

      <div
        className="absolute left-2 top-2 flex flex-col gap-0.5 t-small"
        style={{ background: token("page"), padding: "4px 6px" }}
        data-proto-c-header=""
      >
        <span>
          {systemName ?? <span className="text-ink-2">no system name in the snapshot</span>}
        </span>
        <span className="flex items-center gap-1" data-picture-controls="">
          <Button
            type="button"
            kind="framed"
            icon={ArrowRightLeft}
            label="swap pictures (S)"
            reason={`${picture === "model" ? "The schematic" : "The model"} becomes the main picture, ${picture === "model" ? "the model" : "the schematic"} the corner`}
            onClick={swap}
          >
            {picture === "model" ? "schematic" : "model"} large
          </Button>
          {picture === "model" ? (
            <Button
              type="button"
              kind="framed"
              pressed={camera === "plan"}
              label="plan camera (P)"
              reason="Look straight down, north up; press again for the isometric"
              onClick={turnCamera}
            >
              plan
            </Button>
          ) : null}
        </span>
        <span>
          fan static{" "}
          <span className="face-mono">{solved ? `${fmt(solved.fan, 4)} in-wg` : "unpriced"}</span>{" "}
          {solved ? <ProvisionalNote provisional={solved.provisional} of="the fan static" /> : null}
        </span>
        <span>
          critical run{" "}
          {criticalPath ? (
            <>
              <span className="face-mono">{fmt(criticalPath.total, 4)} in-wg</span> to {criticalName}
            </>
          ) : (
            <span className="text-ink-2">unpriced</span>
          )}
        </span>
      </div>

      {/* Lifted one control row so the proto's variant switcher pill never covers it. */}
      <div className="absolute bottom-12 left-2 flex flex-col items-start gap-1">
        <ScaleLegend
          encoding={scale.encoding}
          counts={scale.counts}
          nameOf={scale.nameOf}
          onSelect={(id) => onSelect(id)}
        />
        {picture === "model" ? <KeyLegend keys={CANVAS_KEYS} lead={0} /> : null}
      </div>

      <div
        className="border-line absolute flex overflow-hidden border"
        style={{
          right: CORNER.margin,
          bottom: CORNER.margin,
          width: CORNER.width,
          height: CORNER.height,
          background: token("page"),
        }}
        data-picture-corner={picture === "model" ? "schematic" : "model"}
      >
        {picture === "model" ? (
          <Schematic
            index={index}
            group={page.group}
            encoding={scale.encoding}
            selected={selected}
            lit={litAll}
            onSelect={pickElement}
            onHover={onHover}
            size="inset"
          />
        ) : (
          <div className="pointer-events-none relative size-full">
            <DuctDrawing
              label="model, small"
              project={cornerProject}
              scene={iso.scene}
              encoding={scale.encoding}
              fitKey={`${iso.fitKey}|corner`}
              selected={selected}
              critical={litAll}
              hovered={hovered}
              issue=""
              onHover={onHover}
              onSelect={() => undefined}
              onSelectIssue={() => undefined}
            />
          </div>
        )}
      </div>

      <Popover open={!!open} onOpenChange={(o) => (o ? null : setOpen(null))}>
        <PopoverContent anchor={anchor} data-proto-c-popover={open?.what ?? ""}>
          {openRuling ? (
            <RulingBody
              r={openRuling}
              nameOfId={nameOfId}
              onVerdict={subject?.onVerdict}
              work={work}
              doc={doc}
              onHover={onHover}
              onPick={onSelect}
            />
          ) : elementId != null ? (
            <div className="flex flex-col gap-2">
              {segFacts ? (
                <SegmentFactsView {...segFacts} />
              ) : nodeFacts ? (
                <NodeFactsView {...nodeFacts} />
              ) : (
                <p className="text-ink-2">element {nameOfId(elementId) ?? elementId} is not drawn here</p>
              )}
              <p data-pe-loss={elementId}>
                Pe loss <span className="face-mono">{fmt(index.loss.get(elementId), 4)}</span> in-wg ·
                from fan <span className="face-mono">{fmt(cumulative.get(elementId), 4)}</span> in-wg
                {priced ? null : <span className="text-ink-2"> (unpriced: no ASHRAE tables read)</span>}
              </p>
              {sub?.legOf.get(elementId) ? <p>on leg {sub.legOf.get(elementId)!.name}</p> : null}
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RulingBody({
  r,
  nameOfId,
  onVerdict,
  work,
  doc,
  onHover,
  onPick,
}: {
  r: Ruling;
  nameOfId: (id: number) => string | null;
  onVerdict?: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => void;
  work: ProtoProps["work"];
  doc: ProtoProps["doc"];
  onHover: (id: number | null) => void;
  onPick: (id: number) => void;
}) {
  const [said, setSaid] = useState<string | null>(null);
  if (r.kind === "claim")
    return (
      <div className="flex flex-col gap-2" data-ruling={r.n}>
        <p>
          <span className="face-mono">{r.n}</span> Pea claim · {r.claim.state}
        </p>
        <p>
          <ClaimText
            parts={claimParts(r.claim.text, nameOfId)}
            doc={doc}
            onHover={onHover}
            onPick={onPick}
            onShown={setSaid}
          />
          {said ? <span className="text-ink-2"> · {said}</span> : null}
        </p>
        <span className="flex gap-1" role="group" aria-label="verdict">
          {VERDICTS.map((v) => (
            <Button
              key={v.value}
              type="button"
              kind="framed"
              label={v.word}
              reason={v.says}
              pressed={r.claim.verdict === v.value}
              data-verdict={v.value}
              onClick={() => onVerdict?.(r.claim, v.value)}
            >
              {v.word}
            </Button>
          ))}
        </span>
      </div>
    );
  if (r.kind === "inferred")
    return (
      <div className="flex flex-col gap-2" data-ruling={r.n}>
        <p>
          <span className="face-mono">{r.n}</span> inferred join · a person rules
        </p>
        <FindingsList
          findings={[r.finding]}
          work={{ doc: work.doc, write: work.write as (p: unknown) => Promise<unknown> }}
        />
      </div>
    );
  const info = ISSUE_KINDS[r.issue.kind];
  return (
    <div className="flex flex-col gap-2" data-ruling={r.n}>
      <p>
        <span className="face-mono">{r.n}</span> snapshot issue ·{" "}
        <span data-tone={info.color.tone}>{info.label}</span>
      </p>
      <p>{r.issue.note}</p>
      <p className="text-ink-2">{info.what} No verdict verb exists for a snapshot issue.</p>
    </div>
  );
}
