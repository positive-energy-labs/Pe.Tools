/**
 * THROWAWAY (protoui round 1, variant C "canvas only"): the iso drawing is the whole screen. Loss
 * labels and ruling pins ride DuctDrawing's `underlay` slot, so they share its real camera
 * (drawing feet, counter-scaled to screen px from the visible box). Facts open in click-anchored
 * kit popovers. No sidebars, no tables.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@pe/kit/lang/button";
import { Popover, PopoverContent } from "@pe/kit/lang/popover";
import { token } from "@pe/kit/lib/token";
import { INFERRED_KINDS } from "@pe/ducts-domain/proximity";
import { snapshotById } from "@pe/ducts-domain/readiness";
import { survey } from "@pe/ducts-domain/survey";
import type { DuctFinding } from "@pe/agent-contracts";

import { claimParts, elementNamer, VERDICTS } from "../../claims";
import { DuctDrawing } from "../../drawing";
import { claimInk, encodingOf, issueInk, type Issue } from "../../encoding";
import { NodeFactsView, SegmentFactsView } from "../../facts";
import { FindingsList, ISSUE_KINDS } from "../../issues";
import { useIso } from "../../iso";
import { labelOfNode, legsOf, type Claim } from "../../legs";
import { ProvisionalNote } from "../../provisional";
import { indexOf, subjectScene } from "../../scene";
import type { ProtoProps } from "../props";

type Ruling =
  | { kind: "claim"; n: number; at: number; claim: Claim }
  | { kind: "inferred"; n: number; at: number; finding: DuctFinding }
  | { kind: "issue"; n: number; at: number; issue: Issue };

type Open =
  | { what: "element"; id: number; x: number; y: number }
  | { what: "ruling"; n: number; x: number; y: number }
  | { what: "list"; x: number; y: number }
  | null;

const PIN = 8;
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

export function CanvasOnly(props: ProtoProps) {
  const { snapshot, priced, page, setPage, subject, work } = props;
  // The route only reads ASHRAE tables (and prices) when `page.view` is plan/iso/losses.
  useEffect(() => {
    if (page.view !== "iso") setPage({ view: "iso" });
  }, [page.view, setPage]);
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
  fromFixture,
}: ProtoProps & { snapshot: NonNullable<ProtoProps["snapshot"]> }) {
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
      if (issue.elementId != null && drawn.has(issue.elementId))
        out.push({ kind: "issue", n: 0, at: issue.elementId, issue });
    return out.map((r, i) => ({ ...r, n: i + 1 }));
  }, [claims, priced, snapshot, work.doc, drawn]);

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
              onPointerDown={(e) => e.stopPropagation()}
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
      data-proto="C"
      className="relative flex size-full min-h-0 flex-col"
      onPointerDownCapture={(e) => {
        pointer.current = at(e);
      }}
    >
      <DuctDrawing
        label="isometric"
        project={iso.project}
        scene={iso.scene}
        encoding={encodingOf(page.encoding)}
        fitKey={iso.fitKey}
        selected={selected}
        hovered={hovered}
        issue={page.issue}
        claim=""
        onHover={onHover}
        onSelect={(id) => {
          onSelect(id);
          setOpen(id == null ? null : { what: "element", id, ...pointer.current });
        }}
        onSelectIssue={(issue) => {
          const r = rulings.find((x) => x.kind === "issue" && x.issue.id === issue.id);
          if (r) setOpen({ what: "ruling", n: r.n, ...pointer.current });
        }}
        onDrag={iso.onDrag}
        underlay={underlay}
      />

      <div
        className="absolute left-2 top-2 flex flex-col gap-0.5 t-small"
        style={{ background: token("page"), padding: "4px 6px" }}
        data-proto-c-header=""
      >
        <span>
          {systemName ?? <span className="text-ink-2">no system name in the snapshot</span>}
          {fromFixture ? <span className="text-ink-2"> · fixture</span> : null}
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

      <div className="absolute right-2 top-2">
        <Button
          type="button"
          kind="framed"
          label="every ruling on this drawing"
          data-proto-c-rulings={rulings.length}
          onClick={(e) => setOpen({ what: "list", ...at(e) })}
        >
          {rulings.length} rulings
        </Button>
      </div>

      <Popover open={!!open} onOpenChange={(o) => (o ? null : setOpen(null))}>
        <PopoverContent anchor={anchor} data-proto-c-popover={open?.what ?? ""}>
          {open?.what === "list" ? (
            <ol className="flex flex-col gap-1">
              {rulings.map((r) => (
                <li key={r.n}>
                  <button
                    type="button"
                    className="cursor-pointer text-left"
                    onClick={() => {
                      onSelect(r.at);
                      setOpen({ what: "ruling", n: r.n, x: open.x, y: open.y });
                    }}
                  >
                    <span className="face-mono">{r.n}</span> {r.kind} ·{" "}
                    {r.kind === "claim"
                      ? r.claim.text.slice(0, 70)
                      : r.kind === "issue"
                        ? ISSUE_KINDS[r.issue.kind].label
                        : `${r.finding.kind}${r.finding.grade ? `, ${r.finding.grade}` : ""}`}
                  </button>
                </li>
              ))}
              {rulings.length === 0 ? <li className="text-ink-2">nothing to rule on in this drawing</li> : null}
            </ol>
          ) : openRuling ? (
            <RulingBody
              r={openRuling}
              nameOfId={nameOfId}
              onVerdict={subject?.onVerdict}
              work={work}
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
}: {
  r: Ruling;
  nameOfId: (id: number) => string | null;
  onVerdict?: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => void;
  work: ProtoProps["work"];
}) {
  if (r.kind === "claim")
    return (
      <div className="flex flex-col gap-2" data-ruling={r.n}>
        <p>
          <span className="face-mono">{r.n}</span> Pea claim · {r.claim.state}
        </p>
        <p>
          {claimParts(r.claim.text, nameOfId).map((part, i) =>
            typeof part === "string" ? <span key={i}>{part}</span> : <span key={i} className="underline decoration-dotted">{part.name}</span>,
          )}
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
