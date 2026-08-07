/**
 * /rhvac plan overlay — per-level SVG of the takeoff room polygons, colored by
 * match state (matched to an rhvac room / unmatched candidate), with the rhvac
 * rooms that have no polygon listed separately. Click a matched polygon to
 * select that room in the grid; the focused room's polygon highlights. Plain
 * SVG: viewBox fit per level, wheel zoom about the cursor, drag to pan.
 *
 * Ambiguity flags (Partition formulation) get a distinct clay dashed state and
 * a "needs decision" queue: each flag resolves with one touch — accept, or for
 * open-plan-merge draw a split chord (two clicks on the boundary). Reject is
 * one touch; merge selects a survivor with one polygon click. Levels arrive
 * already resolved; this pane only reports new resolutions upward.
 */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "#/components/ui/button";
import { fmtNum } from "#/rhvac/cells";
import {
  mergeShapes,
  nearestOnRing,
  pendingFlags,
  residueToRoom,
  type FlagResolution,
  type PendingFlag,
} from "#/rhvac/resolutions";
import { levelBounds, shapeCentroid, shapePathD, type Bounds } from "#/rhvac/takeoff";
import {
  candidateKey,
  KNOWN_FLAG_KINDS,
  type RhvacRoom,
  type RhvacTakeoffData,
  type TakeoffLevel,
} from "#/rhvac/types";
import { cn } from "#/lib/utils";

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const fitView = (bounds: Bounds): ViewBox => {
  const pad = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.04;
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad, // flipped-Y space shares the same numeric range
    w: bounds.maxX - bounds.minX + pad * 2,
    h: bounds.maxY - bounds.minY + pad * 2,
  };
};

/** In-flight split-chord draft: the room being split and its first clicked point (model coords). */
interface SplitDraft {
  candidateKey: string;
  levelIndex: number;
  roomId: string;
  flag: string;
  anchor: NonNullable<FlagResolution["anchor"]>;
  first: [number, number] | null;
}

type MergeDraft = Omit<SplitDraft, "first">;

interface ResidueDraft {
  candidateKey: string;
  levelIndex: number;
  residueId: string;
  reason: string;
  anchor: NonNullable<FlagResolution["anchor"]>;
}

export interface PlanPaneProps {
  /** Already resolved — routes apply the resolutions sidecar before passing levels here. */
  takeoff: RhvacTakeoffData | null;
  takeoffError: string | null;
  rooms: RhvacRoom[];
  /** "<level>:<roomId>" → room identifier (built against baseline room numbers). */
  matchByCandidate: ReadonlyMap<string, number>;
  /** identifier → curated skip reason for rooms deliberately without a polygon. */
  skipReasonById: ReadonlyMap<number, string>;
  focusedId: number | null;
  onPickRoom: (identifier: number) => void;
  /** Count of durable resolutions already recorded for this takeoff source. */
  resolutionCount: number;
  orphanCount: number;
  recordedAgainstOlderDetection: boolean;
  onResolve: (resolution: FlagResolution) => void;
  onDownloadResolutions: () => void;
  onResetResolutions: () => void;
}

export function PlanPane(props: PlanPaneProps) {
  const { takeoff, rooms, matchByCandidate, focusedId } = props;
  const [levelIndex, setLevelIndex] = useState(0);
  const [focusedFlagKey, setFocusedFlagKey] = useState<string | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft | null>(null);
  const [mergeDraft, setMergeDraft] = useState<MergeDraft | null>(null);
  const [residueDraft, setResidueDraft] = useState<ResidueDraft | null>(null);

  const roomsById = useMemo(() => new Map(rooms.map((r) => [r.identifier, r])), [rooms]);
  const matchedIds = useMemo(() => new Set(matchByCandidate.values()), [matchByCandidate]);
  const unmatchedRooms = useMemo(
    () => rooms.filter((r) => !matchedIds.has(r.identifier)),
    [rooms, matchedIds],
  );
  const pending = useMemo(() => (takeoff ? pendingFlags(takeoff.levels) : []), [takeoff]);

  if (!takeoff) {
    return (
      <div className="space-y-2 p-3 text-xs text-muted-foreground">
        <p>No takeoff plan loaded.</p>
        {props.takeoffError && (
          <p className="rounded-[var(--radius)] border border-destructive/40 bg-destructive/10 p-2 text-destructive">
            {props.takeoffError}
          </p>
        )}
      </div>
    );
  }

  const level = takeoff.levels[Math.min(levelIndex, takeoff.levels.length - 1)];
  if (!level) return <p className="p-3 text-xs text-muted-foreground">Takeoff has no levels.</p>;

  const focusFlag = (flag: PendingFlag) => {
    setLevelIndex(flag.levelIndex);
    setFocusedFlagKey(flag.candidateKey);
  };

  const beginSplit = (flag: PendingFlag) => {
    focusFlag(flag);
    setMergeDraft(null);
    setResidueDraft(null);
    setSplitDraft({
      candidateKey: flag.candidateKey,
      levelIndex: flag.levelIndex,
      roomId: flag.roomId,
      flag: flag.flag,
      anchor: flag.anchor,
      first: null,
    });
  };

  const beginMerge = (flag: PendingFlag) => {
    focusFlag(flag);
    setSplitDraft(null);
    setResidueDraft(null);
    setMergeDraft({
      candidateKey: flag.candidateKey,
      levelIndex: flag.levelIndex,
      roomId: flag.roomId,
      flag: flag.flag,
      anchor: flag.anchor,
    });
  };

  const resolve = (resolution: FlagResolution) => {
    setSplitDraft(null);
    setMergeDraft(null);
    setResidueDraft(null);
    setFocusedFlagKey(null);
    props.onResolve(resolution);
  };

  const onSplitPoint = (point: [number, number]) => {
    if (!splitDraft) return;
    if (splitDraft.first === null) {
      setSplitDraft({ ...splitDraft, first: point });
      return;
    }
    resolve({
      candidateKey: splitDraft.candidateKey,
      flag: splitDraft.flag,
      action: "split",
      params: { a: splitDraft.first, b: point },
      anchor: splitDraft.anchor,
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--line)] px-2 py-1.5">
        {takeoff.levels.map((l, i) => (
          <Button
            key={l.levelName}
            size="xs"
            variant={i === levelIndex ? "secondary" : "ghost"}
            onClick={() => setLevelIndex(i)}
            title={l.levelName}
          >
            {l.levelName.split("/").pop() ?? l.levelName}
            {pending.some((p) => p.levelIndex === i) && (
              <span className="ml-1 inline-block size-1.5 rounded-full bg-cat-clay" />
            )}
          </Button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1">
        <LevelSvg
          key={level.levelName}
          level={level}
          roomsById={roomsById}
          matchByCandidate={matchByCandidate}
          focusedId={focusedId}
          focusedFlagKey={focusedFlagKey}
          splitDraft={splitDraft?.levelIndex === levelIndex ? splitDraft : null}
          mergeDraft={mergeDraft?.levelIndex === levelIndex ? mergeDraft : null}
          residueDraft={residueDraft?.levelIndex === levelIndex ? residueDraft : null}
          onPickRoom={props.onPickRoom}
          onPickFlagged={setFocusedFlagKey}
          onSplitPoint={onSplitPoint}
          onMergeTarget={(other, anchor) => {
            if (!mergeDraft || other === mergeDraft.candidateKey) return;
            resolve({
              candidateKey: mergeDraft.candidateKey,
              flag: mergeDraft.flag,
              action: "merge",
              params: { other, anchor },
              anchor: mergeDraft.anchor,
            });
          }}
          onPickResidue={(residue) => {
            if (residue.claimed) return;
            setSplitDraft(null);
            setMergeDraft(null);
            setResidueDraft({
              candidateKey: candidateKey(level.levelName, residue.id),
              levelIndex,
              residueId: residue.id,
              reason: residue.reason,
              anchor: { label: residue.label, sqft: residue.rawSqft },
            });
          }}
          onClaimTarget={(into, anchor) => {
            if (!residueDraft) return;
            resolve({
              candidateKey: residueDraft.candidateKey,
              flag: `residue:${residueDraft.reason}`,
              action: "claim-residue",
              params: { residueId: residueDraft.residueId, into, anchor },
              anchor: residueDraft.anchor,
            });
          }}
        />
        {splitDraft && (
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-[var(--radius)] border border-cat-clay/40 bg-background/95 px-2.5 py-1.5 shadow-sm">
            <span className="tele text-cat-clay">
              split {splitDraft.roomId} — click boundary point{" "}
              {splitDraft.first ? "2 of 2" : "1 of 2"}
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => setSplitDraft(null)}
            >
              cancel
            </Button>
          </div>
        )}
        {mergeDraft && (
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-[var(--radius)] border border-cat-clay/40 bg-background/95 px-2.5 py-1.5 shadow-sm">
            <span className="tele text-cat-clay">
              merge {mergeDraft.roomId} into â€¦ click neighbor polygon
            </span>
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              onClick={() => setMergeDraft(null)}
            >
              cancel
            </Button>
          </div>
        )}
        {residueDraft && (
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-[var(--radius)] border border-muted-foreground/40 bg-background/95 px-2.5 py-1.5 shadow-sm">
            <span className="tele text-muted-foreground">
              claim {residueDraft.residueId} — click neighbor or promote
            </span>
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              onClick={() =>
                resolve({
                  candidateKey: residueDraft.candidateKey,
                  flag: `residue:${residueDraft.reason}`,
                  action: "claim-residue",
                  params: { residueId: residueDraft.residueId },
                  anchor: residueDraft.anchor,
                })
              }
            >
              promote
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setResidueDraft(null)}>
              cancel
            </Button>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3 border-t border-[var(--line)] px-2.5 py-1">
        <LegendChip color="var(--cat-blue)" label="matched" />
        <LegendChip color="var(--cat-kiln)" label="unmatched" />
        {pending.length > 0 && <LegendChip color="var(--cat-clay)" label="flagged" dashed />}
        {level.residues.some((residue) => !residue.claimed) && (
          <LegendChip color="var(--muted-foreground)" label="unclaimed residue" />
        )}
        <LegendChip color="var(--primary)" label="selected" />
        <span className="tele ml-auto text-muted-foreground">wheel zoom · drag pan</span>
      </div>

      {(pending.length > 0 || props.resolutionCount > 0) && (
        <FlagQueue
          pending={pending}
          focusedFlagKey={focusedFlagKey}
          resolutionCount={props.resolutionCount}
          orphanCount={props.orphanCount}
          recordedAgainstOlderDetection={props.recordedAgainstOlderDetection}
          onFocus={focusFlag}
          onBeginSplit={beginSplit}
          onBeginMerge={beginMerge}
          onAccept={(flag) =>
            resolve({
              candidateKey: flag.candidateKey,
              flag: flag.flag,
              action: "accept",
              anchor: flag.anchor,
            })
          }
          onReject={(flag) =>
            resolve({
              candidateKey: flag.candidateKey,
              flag: flag.flag,
              action: "reject",
              anchor: flag.anchor,
            })
          }
          onDownload={props.onDownloadResolutions}
          onReset={props.onResetResolutions}
        />
      )}

      {unmatchedRooms.length > 0 && (
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-[var(--line)] px-2.5 py-1.5">
          <p className="section-label mb-1">
            rooms with no polygon
            <span className="tele ml-1.5 normal-case text-muted-foreground">
              {unmatchedRooms.length}
            </span>
          </p>
          <ul className="space-y-px">
            {unmatchedRooms.map((room) => (
              <li key={room.identifier}>
                <button
                  type="button"
                  className={cn(
                    "tele w-full truncate rounded-[var(--radius)] px-1 py-px text-left hover:bg-muted",
                    focusedId === room.identifier && "bg-primary/10",
                  )}
                  title={props.skipReasonById.get(room.identifier) ?? "not in the curated room map"}
                  onClick={() => props.onPickRoom(room.identifier)}
                >
                  #{room.number} {room.name}
                  {props.skipReasonById.has(room.identifier) && (
                    <span className="ml-1 text-muted-foreground">(skipped)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Compact "needs decision" queue — one row per unresolved ambiguity flag, with
 * its one-touch resolutions inline. The detector refused to guess here; every
 * row is a human call, recorded durably in the resolutions sidecar.
 */
function FlagQueue({
  pending,
  focusedFlagKey,
  resolutionCount,
  orphanCount,
  recordedAgainstOlderDetection,
  onFocus,
  onBeginSplit,
  onBeginMerge,
  onAccept,
  onReject,
  onDownload,
  onReset,
}: {
  pending: PendingFlag[];
  focusedFlagKey: string | null;
  resolutionCount: number;
  orphanCount: number;
  recordedAgainstOlderDetection: boolean;
  onFocus: (flag: PendingFlag) => void;
  onBeginSplit: (flag: PendingFlag) => void;
  onBeginMerge: (flag: PendingFlag) => void;
  onAccept: (flag: PendingFlag) => void;
  onReject: (flag: PendingFlag) => void;
  onDownload: () => void;
  onReset: () => void;
}) {
  const counts = new Map<string, number>();
  for (const flag of pending) counts.set(flag.flag, (counts.get(flag.flag) ?? 0) + 1);

  return (
    <div className="max-h-48 shrink-0 overflow-y-auto border-t border-cat-clay/30 bg-cat-clay/5 px-2.5 py-1.5">
      <p className="section-label mb-1 text-cat-clay">
        needs decision
        <span className="tele ml-1.5 normal-case">
          {[...counts.entries()].map(([kind, n]) => `${n} ${kind}`).join(" · ") || "none pending"}
        </span>
      </p>
      <ul className="space-y-px">
        {pending.map((flag) => (
          <li
            key={`${flag.candidateKey}:${flag.flag}`}
            className={cn(
              "flex items-center gap-1.5 rounded-[var(--radius)] px-1 py-px",
              focusedFlagKey === flag.candidateKey && "bg-cat-clay/10",
            )}
          >
            <button
              type="button"
              className="tele min-w-0 flex-1 truncate text-left hover:underline"
              title={`${flag.levelName} · ${KNOWN_FLAG_KINDS[flag.flag as keyof typeof KNOWN_FLAG_KINDS] ?? flag.flag}`}
              onClick={() => onFocus(flag)}
            >
              {flag.roomId} <span className="text-muted-foreground">{flag.flag}</span>{" "}
              <span className="text-muted-foreground">{fmtNum(flag.rawSqft, 0)} sf</span>
            </button>
            {flag.flag === "open-plan-merge" && (
              <Button size="xs" variant="outline" onClick={() => onBeginSplit(flag)}>
                split
              </Button>
            )}
            <Button size="xs" variant="outline" onClick={() => onBeginMerge(flag)}>
              merge intoâ€¦
            </Button>
            <Button size="xs" variant="ghost" onClick={() => onAccept(flag)}>
              {flag.flag === "open-plan-merge" ? "keep as one" : "accept"}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => onReject(flag)}>
              reject
            </Button>
          </li>
        ))}
      </ul>
      {resolutionCount > 0 && (
        <div className="mt-1 flex items-center gap-1.5 border-t border-cat-clay/20 pt-1">
          <span className="tele text-muted-foreground">{resolutionCount} resolved</span>
          <span className={cn("tele text-muted-foreground", orphanCount > 0 && "text-destructive")}>
            {orphanCount} orphaned
          </span>
          {recordedAgainstOlderDetection && (
            <span className="tele text-cat-clay">recorded against an older detection</span>
          )}
          <Button size="xs" variant="ghost" className="ml-auto" onClick={onDownload}>
            download json
          </Button>
          <Button size="xs" variant="ghost" onClick={onReset}>
            reset
          </Button>
        </div>
      )}
    </div>
  );
}

function LegendChip({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="tele inline-flex items-center gap-1 text-muted-foreground">
      <span
        className={cn("inline-block size-2.5 rounded-[1px] border", dashed && "border-dashed")}
        style={{
          background: `color-mix(in srgb, ${color} 18%, transparent)`,
          borderColor: color,
        }}
      />
      {label}
    </span>
  );
}

function LevelSvg({
  level,
  roomsById,
  matchByCandidate,
  focusedId,
  focusedFlagKey,
  splitDraft,
  mergeDraft,
  residueDraft,
  onPickRoom,
  onPickFlagged,
  onSplitPoint,
  onMergeTarget,
  onPickResidue,
  onClaimTarget,
}: {
  level: TakeoffLevel;
  roomsById: ReadonlyMap<number, RhvacRoom>;
  matchByCandidate: ReadonlyMap<string, number>;
  focusedId: number | null;
  focusedFlagKey: string | null;
  splitDraft: SplitDraft | null;
  mergeDraft: MergeDraft | null;
  residueDraft: ResidueDraft | null;
  onPickRoom: (identifier: number) => void;
  onPickFlagged: (candidateKey: string) => void;
  onSplitPoint: (point: [number, number]) => void;
  onMergeTarget: (candidateKey: string, anchor: NonNullable<FlagResolution["anchor"]>) => void;
  onPickResidue: (residue: TakeoffLevel["residues"][number]) => void;
  onClaimTarget: (candidateKey: string, anchor: NonNullable<FlagResolution["anchor"]>) => void;
}) {
  const bounds = useMemo(() => levelBounds(level), [level]);
  const initial = useMemo(() => (bounds ? fitView(bounds) : null), [bounds]);
  const [view, setView] = useState<ViewBox | null>(initial);
  const svgRef = useRef<SVGSVGElement>(null);
  const draggedRef = useRef(false);

  const shapes = useMemo(() => {
    if (!bounds) return [];
    return level.rooms.map((shape) => {
      const key = candidateKey(level.levelName, shape.id);
      const identifier = matchByCandidate.get(key);
      return {
        shape,
        key,
        identifier,
        flagged: (shape.flags?.length ?? 0) > 0,
        d: shapePathD(shape, bounds),
        centroid: shapeCentroid(shape, bounds),
      };
    });
  }, [level, bounds, matchByCandidate]);

  // Wheel zoom about the cursor — native non-passive listener (React's onWheel
  // is passive, so preventDefault would be ignored and the pane would scroll).
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !initial) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => {
        const cur = v ?? initial;
        const rect = el.getBoundingClientRect();
        const factor = e.deltaY > 0 ? 1.18 : 1 / 1.18;
        const w = Math.min(initial.w * 3, Math.max(initial.w / 40, cur.w * factor));
        const scale = w / cur.w;
        const px = cur.x + ((e.clientX - rect.left) / rect.width) * cur.w;
        const py = cur.y + ((e.clientY - rect.top) / rect.height) * cur.h;
        return { x: px - (px - cur.x) * scale, y: py - (py - cur.y) * scale, w, h: cur.h * scale };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [initial]);

  if (!bounds || !initial)
    return <p className="p-3 text-xs text-muted-foreground">Level has no polygons.</p>;
  const v = view ?? initial;
  const fontSize = initial.w / 70;
  /** Model Y is up, SVG Y is down — same mirror as takeoff.ts flipY. */
  const toModel = (svgX: number, svgY: number): [number, number] => [
    svgX,
    bounds.minY + bounds.maxY - svgY,
  ];
  const toSvgY = (modelY: number) => bounds.minY + bounds.maxY - modelY;

  /** Exact client→viewBox mapping (screen CTM honors xMidYMid letterboxing). */
  const clientToSvg = (clientX: number, clientY: number): [number, number] => {
    const el = svgRef.current!;
    const ctm = el.getScreenCTM();
    if (ctm) {
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return [p.x, p.y];
    }
    const rect = el.getBoundingClientRect();
    return [
      v.x + ((clientX - rect.left) / rect.width) * v.w,
      v.y + ((clientY - rect.top) / rect.height) * v.h,
    ];
  };

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!splitDraft || draggedRef.current) return;
    const target = level.rooms.find((room) => room.id === splitDraft.roomId);
    if (!target) return;
    const [sx, sy] = clientToSvg(e.clientX, e.clientY);
    // Snap the raw click to the room's outer ring so the recorded chord is
    // deterministic against a re-parse of the same TSV.
    onSplitPoint(nearestOnRing(target.outer, toModel(sx, sy)).point);
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    draggedRef.current = false;
    const start = { x: e.clientX, y: e.clientY, view: v };
    const move = (ev: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      const dx = ((ev.clientX - start.x) / rect.width) * start.view.w;
      const dy = ((ev.clientY - start.y) / rect.height) * start.view.h;
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > 4) {
        // Capture only once a real drag starts — capturing on pointerdown retargets
        // the click to the svg, so polygon onClick never fires.
        if (!draggedRef.current) el.setPointerCapture(ev.pointerId);
        draggedRef.current = true;
      }
      setView({ ...start.view, x: start.view.x - dx, y: start.view.y - dy });
    };
    const up = (ev: PointerEvent) => {
      if (draggedRef.current) el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      className={cn(
        "size-full touch-none bg-card",
        (splitDraft || mergeDraft || residueDraft) && "cursor-crosshair",
      )}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={onPointerDown}
      onClick={onSvgClick}
      onDoubleClick={() => setView(initial)}
    >
      <title>{level.levelName}</title>
      {level.residues.map((residue) => (
        <path
          key={residue.id}
          d={shapePathD(residue, bounds)}
          fill="color-mix(in srgb, var(--muted-foreground) 12%, transparent)"
          stroke="var(--muted-foreground)"
          strokeOpacity={0.35}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className={residue.claimed ? undefined : "cursor-pointer"}
          onClick={(event) => {
            event.stopPropagation();
            if (!residue.claimed && !draggedRef.current && !splitDraft && !mergeDraft)
              onPickResidue(residue);
          }}
        />
      ))}
      {shapes.map(({ shape, key, identifier, flagged, d, centroid }) => {
        const room = identifier !== undefined ? roomsById.get(identifier) : undefined;
        const selected =
          (identifier !== undefined && identifier === focusedId) ||
          (flagged && key === focusedFlagKey);
        const stroke = shape.rejected
          ? "var(--muted-foreground)"
          : selected
            ? flagged
              ? "var(--cat-clay)"
              : "var(--primary)"
            : flagged
              ? "var(--cat-clay)"
              : room
                ? "var(--cat-blue)"
                : "var(--cat-kiln)";
        const fill = shape.rejected
          ? "color-mix(in srgb, var(--muted-foreground) 8%, transparent)"
          : selected
            ? `color-mix(in srgb, ${flagged ? "var(--cat-clay)" : "var(--primary)"} 28%, transparent)`
            : flagged
              ? "color-mix(in srgb, var(--cat-clay) 12%, transparent)"
              : room
                ? "color-mix(in srgb, var(--cat-blue) 12%, transparent)"
                : "color-mix(in srgb, var(--cat-kiln) 10%, transparent)";
        return (
          <g
            key={shape.id}
            opacity={shape.rejected ? 0.35 : undefined}
            className={cn((identifier !== undefined || flagged || mergeDraft) && "cursor-pointer")}
            onClick={() => {
              if (draggedRef.current || splitDraft) return;
              if (mergeDraft) {
                const source = level.rooms.find((room) => room.id === mergeDraft.roomId);
                if (!source || !mergeShapes(source, shape, mergeDraft.flag)) return;
                onMergeTarget(key, { label: shape.label, sqft: shape.rawSqft });
                return;
              }
              if (residueDraft) {
                const residue = level.residues.find((item) => item.id === residueDraft.residueId);
                if (!residue || !mergeShapes(residueToRoom(residue), shape, residueDraft.reason))
                  return;
                onClaimTarget(key, { label: shape.label, sqft: shape.rawSqft });
                return;
              }
              if (identifier !== undefined) onPickRoom(identifier);
              else if (flagged) onPickFlagged(key);
            }}
          >
            <path
              d={d}
              fillRule="evenodd"
              fill={fill}
              stroke={stroke}
              strokeOpacity={flagged ? 0.85 : 0.6}
              strokeWidth={selected ? 2 : flagged ? 1.5 : 1}
              strokeDasharray={flagged ? "5 3" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            {shape.rawSqft > 30 && (
              <text
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                fontSize={fontSize}
                className="pointer-events-none select-none"
                fill={room ? "var(--foreground)" : "var(--muted-foreground)"}
              >
                <tspan x={centroid[0]} fontWeight={600}>
                  {room ? `#${room.number}` : shape.id}
                </tspan>
                <tspan x={centroid[0]} dy={fontSize * 1.1} fillOpacity={0.75}>
                  {fmtNum(shape.rawSqft, 0)} sf
                </tspan>
              </text>
            )}
          </g>
        );
      })}
      {splitDraft?.first && (
        <circle
          cx={splitDraft.first[0]}
          cy={toSvgY(splitDraft.first[1])}
          r={fontSize * 0.35}
          fill="var(--cat-clay)"
          stroke="var(--background)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="pointer-events-none"
        />
      )}
    </svg>
  );
}
