/**
 * B · DRAWING-AS-FORM — one grille, drawn large. Every dimension line IS its input: type on the
 * picture. Drag the edge of any opening to resize it (all openings stay equal, ribs absorb the
 * change); scroll on the board to add/remove openings. Right rail is the full spreadsheet column.
 */
import { useRef } from "react";

import { Board } from "./board";
import { InchField } from "./field";
import type { GrilleInput } from "./math";
import { frac, pct, ribToFill, solve } from "./math";

const PX = 48;

export function VariantB({ g0, set }: { g0: GrilleInput; set: (p: Partial<GrilleInput>) => void }) {
  const g = solve(g0);
  const drag = useRef<{ y0: number; opening: number } | null>(null);
  const snap = (v: number) => Math.round(v * 16) / 16;

  return (
    <div className="flex gap-6 p-4">
      <div
        className="relative"
        onWheel={(e) => {
          e.preventDefault();
          const n = Math.max(1, g.openings + (e.deltaY < 0 ? 1 : -1));
          set({ openings: n, rib: Math.max(0, ribToFill({ ...g, openings: n })) });
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dIn = (e.clientY - drag.current.y0) / PX;
          const opening = Math.max(1 / 16, snap(drag.current.opening + dIn));
          set({ opening, rib: Math.max(0, ribToFill({ ...g, opening })) });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <Board g={g} px={PX}>
          {Array.from({ length: g.openings }, (_, k) => {
            const y = (g.edgeBorder + k * (g.opening + g.rib) + g.opening) * PX;
            return (
              <rect
                key={k}
                x={g.endBorder * PX}
                y={y - 3}
                width={g.openingLength * PX}
                height={6}
                fill="transparent"
                style={{ cursor: "ns-resize" }}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture(e.pointerId);
                  drag.current = { y0: e.clientY, opening: g.opening };
                }}
              />
            );
          })}
        </Board>
        {/* inputs sitting on the dimension lines */}
        <Over x={34 + (g.boardLength * PX) / 2 - 32} y={2}>
          <InchField value={g.boardLength} onChange={(v) => set({ boardLength: v })} />
        </Over>
        <Over x={2} y={34 + (g.boardWidth * PX) / 2 - 10}>
          <InchField value={g.boardWidth} onChange={(v) => set({ boardWidth: v })} />
        </Over>
        <Over x={34 + 4} y={34 + 2}>
          <InchField
            value={g.endBorder}
            onChange={(v) => set({ endBorder: v })}
            style={{ background: "var(--r-surface-2,#d9c3a0)" }}
          />
        </Over>
        <Over x={34 + g.boardLength * PX - 140} y={34 + 2}>
          <label className="face-mono text-[10px]">
            edge{" "}
            <InchField
              value={g.edgeBorder}
              onChange={(v) =>
                set({ edgeBorder: v, rib: Math.max(0, ribToFill({ ...g, edgeBorder: v })) })
              }
              style={{ background: "var(--r-surface-2,#d9c3a0)" }}
            />
          </label>
        </Over>
        <Over
          x={34 + (g.boardLength * PX) / 2 - 90}
          y={34 + (g.edgeBorder + g.opening / 2) * PX - 10}
        >
          <label className="face-mono text-[10px] text-white">
            opening{" "}
            <InchField
              value={g.opening}
              onChange={(v) => set({ opening: v })}
              style={{ color: "white" }}
            />
            {" × "}
            <InchField
              int
              value={g.openings}
              onChange={(v) => set({ openings: v })}
              style={{ color: "white" }}
            />
          </label>
        </Over>
        {g.ribs > 0 && (
          <Over
            x={34 + (g.boardLength * PX) / 2 + 40}
            y={34 + (g.edgeBorder + g.opening + g.rib / 2) * PX - 10}
          >
            <label className="face-mono text-[10px]">
              rib{" "}
              <InchField
                value={g.rib}
                onChange={(v) => set({ rib: v })}
                style={{ background: "var(--r-surface-2,#d9c3a0)" }}
              />
            </label>
          </Over>
        )}
      </div>

      <dl className="face-mono grid grid-cols-[auto_auto] gap-x-4 gap-y-1 self-start text-[12px]">
        {(
          [
            ["Middle available", `${frac(g.middleAvailable)}″`],
            ["Rib / opening length", `${frac(g.openingLength)}″`],
            ["Qty ribs", g.ribs],
            ["Middle dimension", `${frac(g.middleDimension)}″`],
            [
              "Fit",
              g.slack < -1e-9
                ? `✕ over by ${frac(-g.slack)}″`
                : g.slack > 1e-9
                  ? `${frac(g.slack)}″ slack`
                  : "exact",
            ],
            ["Free % before end derate", pct(g.freeAreaBeforeDerate)],
            ["Length derate", g.lengthDerate.toFixed(4)],
            ["Overall free area %", pct(g.freeArea)],
            ["Actual free area", `${g.actualFreeArea.toFixed(2)} in²`],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--r-ink-mute)]">{k}</dt>
            <dd className={k.startsWith("Overall") || k.startsWith("Actual") ? "font-bold" : ""}>
              {v}
            </dd>
          </div>
        ))}
        <dt className="col-span-2 pt-2 text-[10px] text-[var(--r-ink-mute)]">
          drag an opening's lower edge · scroll on the board to change count · type on any dimension
        </dt>
      </dl>
    </div>
  );
}

function Over({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div className="absolute" style={{ left: x, top: y }}>
      {children}
    </div>
  );
}
