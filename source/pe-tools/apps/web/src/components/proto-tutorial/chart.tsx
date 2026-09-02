import { useLayoutEffect, useRef, useState } from "react";

import { targets, type Pane as ModelPane, type Verb } from "#/targeting/model";
import type { CurrentManifest } from "./manifest-ref";
import { paneShortcuts, type MeasuredLayout, type MeasuredPane } from "./measure";

const CARD_W = 240;

function Key({ mute, children }: { mute?: boolean; children: React.ReactNode }) {
  return (
    <kbd
      data-surface="recess"
      className={`face-mono t-small inline-flex min-w-7 shrink-0 items-center justify-center border px-1 py-0.5 ${
        mute ? "border-line text-ink-mute" : "border-line-2 text-ink"
      }`}
    >
      {children}
    </kbd>
  );
}

interface Linked {
  measured: MeasuredPane;
  model: ModelPane<string> | null;
}

const linkPanes = (layout: MeasuredLayout): Linked[] =>
  layout.panes.map((measured) => ({ measured, model: measured.model }));

const touches = (verb: Verb<string>, model: ModelPane<string>) =>
  model.draws.some((key) => (verb.demands as readonly string[]).includes(key));

const verbPanes = (verb: Verb<string>, linked: Linked[]): number[] =>
  linked
    .filter((link) => link.model && touches(verb, link.model))
    .map((link) => link.measured.index);

function Tag({ linked, hot }: { linked: Linked; hot: boolean }) {
  const pane = linked.measured;
  return (
    <div
      data-hot={hot || undefined}
      data-surface="page"
      className={`flex flex-col border-2 ${hot ? "border-line-2" : "border-line"}`}
      style={{ width: CARD_W }}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span className={`t-small t-upper ${hot ? "text-ink" : ""}`}>
          {pane.title || pane.kind} · keys
        </span>
      </div>
      <div className="hairline-t grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 px-2.5 py-2">
        {paneShortcuts(pane).map((shortcut) => (
          <div
            key={shortcut.hotkey}
            className="contents"
            title={shortcut.wired ? undefined : `not wired — needs ${shortcut.needs}`}
          >
            <Key mute={!shortcut.wired}>{shortcut.hotkey}</Key>
            <span className={`t-small ${shortcut.wired ? "text-ink" : "text-ink-mute"}`}>
              {shortcut.label}
              {shortcut.wired ? "" : " ~"}
            </span>
          </div>
        ))}
      </div>
      <div className="hairline-t px-2.5 py-1.5">
        <span className="t-small text-ink-2">{pane.says}</span>
      </div>
    </div>
  );
}

function SentenceBand({ manifest }: { manifest: CurrentManifest | null }) {
  if (!manifest)
    return (
      <span className="t-small text-ink-mute">
        this route renders no targeting sentence — the chart below is measured geometry only
      </span>
    );
  const { product, b } = manifest;
  return (
    <div className="flex min-w-0 items-end justify-between gap-6">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="t-title text-ink">{product.name}</span>
        {targets(product).map((target) => {
          const label = b.labelOf(target);
          const bound = b.isBound(target);
          return (
            <span
              key={target.key}
              className="inline-flex items-baseline gap-1.5"
              title={bound ? undefined : `unbound — ${target.needs}`}
            >
              <span className="face-mono t-small text-ink-2">{target.joiner}</span>
              <span className={bound ? "text-ink" : "text-ink-mute"}>
                {label ?? target.placeholder}
                {bound ? "" : " ∅"}
              </span>
            </span>
          );
        })}
      </div>
      <span className="flex shrink-0 items-baseline gap-2">
        {product.stages.map((stage) => (
          <span
            key={stage.key}
            className={`t-small t-upper ${stage.key === b.stage.key ? "text-ink" : "text-ink-mute"}`}
          >
            {stage.label}
          </span>
        ))}
      </span>
    </div>
  );
}

function VerbBand({
  manifest,
  linked,
  onHot,
}: {
  manifest: CurrentManifest;
  linked: Linked[];
  onHot: (panes: number[] | null) => void;
}) {
  const { product, runner } = manifest;
  return (
    <div className="flex items-start gap-10">
      {product.stages.map((stage) => {
        const stagePanes = [...new Set(stage.verbs.flatMap((verb) => verbPanes(verb, linked)))];
        return (
          <div
            key={stage.key}
            className="flex min-w-56 flex-col gap-1"
            onMouseEnter={() => onHot(stagePanes)}
            onMouseLeave={() => onHot(null)}
          >
            <span className="t-small t-upper hairline-b pb-1 text-ink">{stage.label}</span>
            {stage.verbs.map((verb) => {
              const can = runner.canRun(verb);
              const panes = verbPanes(verb, linked);
              return (
                <div
                  key={verb.key}
                  className="flex items-baseline gap-2"
                  onMouseEnter={() => onHot(panes)}
                  onMouseLeave={() => onHot(stagePanes)}
                >
                  <span className="w-32 shrink-0 truncate text-ink">{verb.label}</span>
                  <span
                    title={can.ok ? undefined : can.reason}
                    className={`face-mono t-small min-w-0 flex-1 truncate ${can.ok ? "text-ink" : "text-ink-mute"}`}
                  >
                    {can.ok ? "ready" : can.reason}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function TutorialChart({
  layout,
  manifest,
}: {
  layout: MeasuredLayout;
  manifest: CurrentManifest | null;
}) {
  const mid = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [hot, setHot] = useState<number[] | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const rect = mid.current?.getBoundingClientRect();
      if (rect) setSize({ w: rect.width, h: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const linked = linkPanes(layout);
  const frame = layout.frame;
  const leftCol = linked.filter(
    (link) =>
      link.measured.rect.left + link.measured.rect.width / 2 <= frame.left + frame.width / 2,
  );
  const rightCol = linked.filter((link) => !leftCol.includes(link));
  const isHot = (index: number) => hot != null && hot.includes(index);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="shrink-0 px-8 pt-6 pb-3">
        <SentenceBand manifest={manifest} />
      </div>
      <div ref={mid} className="relative min-h-0 flex-1">
        {size && (
          <ChartArea
            layout={layout}
            linked={linked}
            leftCol={leftCol}
            rightCol={rightCol}
            size={size}
            isHot={isHot}
            anyHot={hot != null}
          />
        )}
      </div>
      {manifest && (
        <div className="flex shrink-0 items-start overflow-x-auto px-8 pt-3 pb-8">
          <VerbBand manifest={manifest} linked={linked} onHot={setHot} />
        </div>
      )}
    </div>
  );
}

function ChartArea({
  layout,
  linked,
  leftCol,
  rightCol,
  size,
  isHot,
  anyHot,
}: {
  layout: MeasuredLayout;
  linked: Linked[];
  leftCol: Linked[];
  rightCol: Linked[];
  size: { w: number; h: number };
  isHot: (index: number) => boolean;
  anyHot: boolean;
}) {
  const frame = layout.frame;
  const mapW = Math.min(size.w - 2 * (CARD_W + 64), 640);
  const mapH = Math.min(size.h - 24, mapW * (frame.height / frame.width));
  const mapX = (size.w - mapW) / 2;
  const mapY = (size.h - mapH) / 2;
  const cardY = (column: Linked[], index: number) => {
    const spacing = Math.min(200, (size.h - 16) / Math.max(column.length, 1));
    return size.h / 2 - (column.length * spacing) / 2 + index * spacing;
  };
  const point = (pane: MeasuredPane) => ({
    x: mapX + ((pane.rect.left - frame.left + pane.rect.width / 2) / frame.width) * mapW,
    y: mapY + ((pane.rect.top - frame.top + pane.rect.height / 2) / frame.height) * mapH,
  });
  const leader = (link: Linked, fromX: number, y: number, into: number) => {
    const center = point(link.measured);
    const on = isHot(link.measured.index);
    return (
      <polyline
        key={link.measured.index}
        points={`${fromX},${y} ${into},${center.y} ${center.x},${center.y}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={on ? 2 : 1}
        className={on ? "text-ink" : anyHot ? "text-line" : "text-ink-mute"}
      />
    );
  };

  return (
    <>
      <svg width={size.w} height={size.h} className="absolute inset-0 text-ink-mute">
        {leftCol.map((link, index) =>
          leader(link, 24 + CARD_W, cardY(leftCol, index) + 20, mapX - 24),
        )}
        {rightCol.map((link, index) =>
          leader(link, size.w - 24 - CARD_W, cardY(rightCol, index) + 20, mapX + mapW + 24),
        )}
        <g transform={`translate(${mapX},${mapY})`}>
          <rect x={0} y={0} width={mapW} height={mapH} fill="none" stroke="currentColor" />
          {linked.map((link) => {
            const pane = link.measured;
            const x = ((pane.rect.left - frame.left) / frame.width) * mapW;
            const y = ((pane.rect.top - frame.top) / frame.height) * mapH;
            const width = (pane.rect.width / frame.width) * mapW;
            const height = (pane.rect.height / frame.height) * mapH;
            const on = isHot(pane.index);
            return (
              <g
                key={pane.index}
                className={on ? "text-ink" : anyHot ? "text-line" : "text-ink-mute"}
              >
                <rect
                  x={x + 2}
                  y={y + 2}
                  width={Math.max(width - 4, 4)}
                  height={Math.max(height - 4, 4)}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={on ? 2 : 1}
                />
                <text x={x + 8} y={y + 16} fill="currentColor" fontSize={10} fontFamily="inherit">
                  {pane.index + 1} {pane.title || pane.kind}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      {leftCol.map((link, index) => (
        <div
          key={link.measured.index}
          className="absolute"
          style={{ left: 24, top: cardY(leftCol, index) }}
        >
          <Tag linked={link} hot={isHot(link.measured.index)} />
        </div>
      ))}
      {rightCol.map((link, index) => (
        <div
          key={link.measured.index}
          className="absolute"
          style={{ right: 24, top: cardY(rightCol, index) }}
        >
          <Tag linked={link} hot={isHot(link.measured.index)} />
        </div>
      ))}
    </>
  );
}
