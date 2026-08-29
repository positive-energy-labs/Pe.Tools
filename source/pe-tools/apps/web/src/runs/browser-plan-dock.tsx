import { token } from "#/lib/token";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "#/lib/utils";
import {
  boardSummary,
  matchZone,
  type Partiality,
  type RunScores,
  scoreBoards,
  planFrame,
  toPx,
} from "./world";
import { Press } from "#/components/lang/press";
import type { View } from "./browser-frame";
import type { FocusRequest } from "./browser-zone-peek-floater";
import { frameCache, levelFrame, levelViewport, useLevelData } from "./browser-frame";
import { PlanPane } from "./browser-plan-pane";
import { LegendFloater, LevelStatsFloater } from "./browser-legend-floater";
import { ZonePeekFloater } from "./browser-zone-peek-floater";

export function PlanDock(props: {
  curId: string;
  prevId: string | null;
  underlay: boolean;
  focus: FocusRequest | null;
  levels: string[];
  level: string | null;
  onPickLevel: (level: string) => void;
  highlight: string | null;
  onToggleZone: (zone: string) => void;
}) {
  const { curId, prevId, underlay, focus, levels, level } = props;
  const comparing = prevId !== null;

  const [view, setView] = useState<View>({ tx: 0, ty: 0, scale: 1 });
  const [hoverZone, setHoverZone] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<FocusRequest | null>(null);
  const [showKey, setShowKey] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const mainRef = useRef<HTMLDivElement | null>(null);

  const dataCur = useLevelData(curId, level);
  const dataPrev = useLevelData(prevId, level);

  const frame = useMemo(() => {
    if (!level) return null;
    if (dataCur?.plan) return levelFrame(level, planFrame(dataCur.plan.registration));
    if (dataCur?.zones.length) {
      return levelFrame(level, {
        minX: Math.min(...dataCur.zones.map((zone) => zone.MinX)) - 4,
        minY: Math.min(...dataCur.zones.map((zone) => zone.MinY)) - 4,
        maxX: Math.max(...dataCur.zones.map((zone) => zone.MaxX)) + 4,
        maxY: Math.max(...dataCur.zones.map((zone) => zone.MaxY)) + 4,
      });
    }
    return frameCache.get(level) ?? null;
  }, [level, dataCur]);

  useEffect(() => {
    if (!frame) return;
    const el = mainRef.current;
    if (!el || el.clientHeight < 40) return;
    const vp = levelViewport(frame);
    const paneW = comparing ? el.clientWidth / 2 : el.clientWidth;
    const s = Math.min(paneW / vp.widthPx, el.clientHeight / vp.heightPx) * 0.94;
    setView({
      scale: s,
      tx: (paneW - vp.widthPx * s) / 2,
      ty: (el.clientHeight - vp.heightPx * s) / 2,
    });
  }, [frame, comparing]);

  useEffect(() => {
    if (!focus) return;
    setPendingFocus(focus);
  }, [focus]);

  useEffect(() => {
    if (!pendingFocus || !frame || pendingFocus.zone.Level !== level) return;
    const el = mainRef.current;
    if (!el || el.clientHeight < 40) return;
    const vp = levelViewport(frame);
    const z = pendingFocus.zone;
    const [x0, y0] = toPx(vp, z.MinX, z.MaxY);
    const [x1, y1] = toPx(vp, z.MaxX, z.MinY);
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    const paneW = comparing ? el.clientWidth / 2 : el.clientWidth;
    const s = Math.min(8, Math.min(paneW / (w * 1.35), el.clientHeight / (h * 1.35)));
    setView({
      scale: s,
      tx: paneW / 2 - s * (x0 + w / 2),
      ty: el.clientHeight / 2 - s * (y0 + h / 2),
    });
    setPendingFocus(null);
  }, [pendingFocus, frame, level, comparing]);

  useEffect(() => {
    setHoverZone(null);
  }, [level]);

  const { onToggleZone } = props;
  const onPick = useCallback((z: string) => onToggleZone(z), [onToggleZone]);

  const peekZone = hoverZone ?? props.highlight;
  const zoneCur = peekZone ? (dataCur?.zones.find((z) => z.Zone === peekZone) ?? null) : null;
  // only as the pre-key fallback (SHIMS.md #2 close).
  const zonePrev = zoneCur ? matchZone(dataPrev?.zones ?? [], zoneCur) : null;

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div
        className="flex shrink-0 items-center gap-2 border-b px-2 py-1"
        style={{ borderColor: token("line-2") }}
      >
        <div className="flex gap-0.5">
          {levels.map((l) => (
            <Press
              key={l}
              type="button"
              onClick={() => props.onPickLevel(l)}
              title="Show this level on the plan — the sheet scrolls to its section (and scrolling the sheet moves this tab)."
              size="label"
              tone="quiet"
              state={l === level ? "selected" : "rest"}
            >
              {l.replace(" Level", "")}
            </Press>
          ))}
        </div>
        <span className="ml-auto flex items-center gap-1.5">
          <Press
            type="button"
            onClick={() => setShowKey((v) => !v)}
            title="Show/hide the key — what each mark on the plan means."
            size="caption"
            tone="quiet"
            state={showKey ? "selected" : "rest"}
            style={{ borderColor: token("line-2") }}
          >
            key
          </Press>
          <Press
            type="button"
            onClick={() => setShowStats((v) => !v)}
            title="Show/hide the level-stats floater — solve counts, sf, loudest rejections, A/B deltas."
            size="caption"
            tone="quiet"
            state={showStats ? "selected" : "rest"}
            style={{ borderColor: token("line-2") }}
          >
            stats
          </Press>
          <span className="face-mono t-caption text-ink-2">
            drag = pan · wheel = zoom · click zone = highlight · esc = clear
          </span>
        </span>
      </div>
      <div ref={mainRef} className="relative flex min-h-0 flex-1">
        {frame && level ? (
          <>
            {comparing && prevId ? (
              <PlanPane
                runId={prevId}
                tag="A · baseline"
                data={dataPrev}
                frame={frame}
                view={view}
                setView={setView}
                underlay={underlay}
                hoverZone={hoverZone}
                pinnedZone={props.highlight}
                onHover={setHoverZone}
                onPick={onPick}
              />
            ) : null}
            <div
              className={cn("flex flex-1", comparing && "border-l")}
              style={comparing ? { borderColor: token("line-2") } : undefined}
            >
              <PlanPane
                runId={curId}
                tag={comparing ? "B · current" : null}
                data={dataCur}
                frame={frame}
                view={view}
                setView={setView}
                underlay={underlay}
                hoverZone={hoverZone}
                pinnedZone={props.highlight}
                onHover={setHoverZone}
                onPick={onPick}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center t-prose text-ink-2">
            loading {level ?? "level"}…
          </div>
        )}
        {showKey && <LegendFloater underlay={underlay} onClose={() => setShowKey(false)} />}
        {showStats && level && (
          <LevelStatsFloater
            level={level}
            cur={dataCur}
            prev={comparing ? dataPrev : null}
            onClose={() => setShowStats(false)}
          />
        )}
        {peekZone && zoneCur && (
          <ZonePeekFloater
            zoneName={peekZone}
            b={zoneCur}
            a={zonePrev}
            comparing={comparing}
            highlighted={props.highlight === peekZone}
          />
        )}
      </div>
    </div>
  );
}

export type Board = ReturnType<typeof boardSummary>;

/** Scorer columns lifted from the package's scores.json. The python scorer is the only author
 * of these numbers (SHIMS.md #1 close) — this row NEVER computes a stand-in. */
export type RowScores = {
  savedV11: number | null;
  savedV1: number | null;
  recall: number | null;
  edgeAcc: number | null;
};

export type RunRow = {
  id: string;
  label: string | null;
  hash: string;
  when: string;
  board: Board;
  scores: RowScores | null;
  scoreDelta: number | null;
  delta: { solved: number; rooms: number; sqft: number; held: number } | null;
  partiality: Partiality;
};

export function rowScores(scores: RunScores | null): RowScores | null {
  if (!scores) return null;
  const { v11, v1 } = scoreBoards(scores);
  const primary = v11 ?? v1;
  return {
    savedV11: v11?.savedWork ?? null,
    savedV1: v1?.savedWork ?? null,
    recall: primary?.roomRecall ?? null,
    edgeAcc: primary?.edgeOnInkAccepted ?? null,
  };
}
