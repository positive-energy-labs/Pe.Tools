/**
 * C · TARGET-FIRST (overreach) — the sheet answers "what free area does this profile give?"; this
 * variant inverts it: "I need N in² (or X %) — which profiles get there?" Enumerates every opening
 * width × count on the 1/16″ grid that physically fits, plots free-area against rib width (a thin rib
 * is the buildability cost), and clicking a point draws it. Past feasibility on purpose: nobody has
 * said what the real constraints are (min rib, stock widths, CNC kerf) — this is how we find out.
 */
import { useMemo, useState } from "react";

import { Board, Readout } from "./board";
import { InchField } from "./field";
import type { Grille, GrilleInput } from "./math";
import { frac, ribToFill, solve } from "./math";

const MIN_RIB = 1 / 4;

export function VariantC({
  base,
  set,
}: {
  base: GrilleInput;
  set: (p: Partial<GrilleInput>) => void;
}) {
  const [target, setTarget] = useState(0.45);
  const [pick, setPick] = useState<Grille | null>(null);

  const field = useMemo(() => {
    const out: Grille[] = [];
    for (let n = 1; n <= 12; n++)
      for (let o = 4; o <= 32; o++) {
        const opening = o / 16;
        const rib = n === 1 ? 0 : ribToFill({ ...base, opening, openings: n });
        if (rib < 0 || (n > 1 && rib < MIN_RIB)) continue;
        out.push(solve({ ...base, opening, openings: n, rib }));
      }
    return out;
  }, [base]);

  const hits = field.filter((g) => g.freeArea >= target).sort((a, b) => b.rib - a.rib);
  const shown = pick ?? hits[0] ?? null;
  const W = 420;
  const H = 220;
  const maxRib = Math.max(1, ...field.map((g) => g.rib));
  const maxFree = Math.max(0.01, ...field.map((g) => g.freeArea));
  const X = (g: Grille) => (g.rib / maxRib) * (W - 40) + 30;
  const Y = (g: Grille) => H - 20 - (g.freeArea / maxFree) * (H - 30);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="face-mono flex flex-wrap items-center gap-3 text-[12px]">
        <span className="t-label t-upper text-[var(--r-ink-mute)]">Stock</span>
        <InchField value={base.boardLength} onChange={(v) => set({ boardLength: v })} /> ×
        <InchField value={base.boardWidth} onChange={(v) => set({ boardWidth: v })} />
        <span className="t-label t-upper text-[var(--r-ink-mute)]">borders end/edge</span>
        <InchField value={base.endBorder} onChange={(v) => set({ endBorder: v })} />
        <InchField value={base.edgeBorder} onChange={(v) => set({ edgeBorder: v })} />
        <span className="t-label t-upper text-[var(--r-ink-mute)]">Target free area</span>
        <input
          type="range"
          min={5}
          max={80}
          value={Math.round(target * 100)}
          onChange={(e) => {
            setTarget(Number(e.target.value) / 100);
            setPick(null);
          }}
        />
        <b>{Math.round(target * 100)}%</b>
        <span className="text-[var(--r-ink-mute)]">
          {hits.length} of {field.length} profiles reach it (rib ≥ {frac(MIN_RIB)}″)
        </span>
      </div>

      <div className="flex flex-wrap gap-6">
        <svg width={W} height={H} style={{ fontFamily: "ui-monospace, monospace", fontSize: 9 }}>
          <line x1={30} x2={W - 10} y1={H - 20} y2={H - 20} stroke="var(--r-line)" />
          <line x1={30} x2={30} y1={10} y2={H - 20} stroke="var(--r-line)" />
          <text x={W / 2} y={H - 4} textAnchor="middle" fill="var(--r-ink-mute)">
            rib width (wider = easier to build) →
          </text>
          <text x={4} y={12} fill="var(--r-ink-mute)">
            free %
          </text>
          <line
            x1={30}
            x2={W - 10}
            y1={H - 20 - (target / maxFree) * (H - 30)}
            y2={H - 20 - (target / maxFree) * (H - 30)}
            stroke="var(--r-accent, #2b7de9)"
            strokeDasharray="3 3"
          />
          {field.map((g, i) => {
            const on = g === shown;
            return (
              <circle
                key={i}
                cx={X(g)}
                cy={Y(g)}
                r={on ? 5 : 3}
                fill={g.freeArea >= target ? "var(--r-ink)" : "var(--r-line)"}
                stroke={on ? "var(--r-accent,#2b7de9)" : "none"}
                strokeWidth={2}
                style={{ cursor: "pointer" }}
                onClick={() => setPick(g)}
              >
                <title>
                  {g.openings} × {frac(g.opening)}″ openings, {frac(g.rib)}″ ribs →{" "}
                  {(g.freeArea * 100).toFixed(1)}%
                </title>
              </circle>
            );
          })}
        </svg>

        {shown && (
          <div className="flex flex-col gap-2">
            <div className="face-mono text-[12px]">
              <b>
                {shown.openings} × {frac(shown.opening)}″
              </b>{" "}
              openings, <b>{frac(shown.rib)}″</b> ribs
              <button
                type="button"
                className="ml-3 rounded border px-2 text-[11px]"
                style={{ borderColor: "var(--r-line)" }}
                onClick={() =>
                  set({ opening: shown.opening, openings: shown.openings, rib: shown.rib })
                }
              >
                use this in A / B
              </button>
            </div>
            <Board g={shown} px={24} />
            <Readout g={shown} />
          </div>
        )}
      </div>

      <table className="face-mono text-[11px]">
        <thead>
          <tr className="text-left text-[var(--r-ink-mute)]">
            {["qty", "opening", "rib", "free %", "actual in²"].map((h) => (
              <th key={h} className="px-2 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hits.slice(0, 12).map((g, i) => (
            <tr
              key={i}
              className="cursor-pointer"
              style={{ background: g === shown ? "var(--r-surface-2, #eee)" : undefined }}
              onClick={() => setPick(g)}
            >
              <td className="px-2">{g.openings}</td>
              <td className="px-2">{frac(g.opening)}″</td>
              <td className="px-2">{frac(g.rib)}″</td>
              <td className="px-2">{(g.freeArea * 100).toFixed(1)}%</td>
              <td className="px-2">{g.actualFreeArea.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
