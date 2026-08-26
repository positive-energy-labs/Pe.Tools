/**
 * A · SHEET — the spreadsheet, kept honest: one row per candidate profile, inputs editable in
 * place, derived columns live, and a thumbnail drawing per row so a number and its picture arrive
 * together. Closest to what the team already uses.
 */
import { Board } from "./board";
import { InchField } from "./field";
import type { GrilleInput } from "./math";
import { SHEET_ROWS, frac, pct, solve } from "./math";

const IN: { key: keyof GrilleInput; label: string; int?: boolean }[] = [
  { key: "boardWidth", label: "Board width" },
  { key: "edgeBorder", label: "Edge border" },
  { key: "opening", label: "Opening width" },
  { key: "rib", label: "Rib width" },
  { key: "openings", label: "Qty openings", int: true },
];

export function VariantA({
  rows,
  setRows,
}: {
  rows: GrilleInput[];
  setRows: (r: GrilleInput[]) => void;
}) {
  const shared = rows[0] ?? { boardLength: 18, endBorder: 0.75 };
  const setShared = (patch: Partial<GrilleInput>) => setRows(rows.map((r) => ({ ...r, ...patch })));
  const set = (i: number, patch: Partial<GrilleInput>) =>
    setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="face-mono flex items-center gap-3 text-[12px]">
        <span className="t-label t-upper text-[var(--r-ink-mute)]">Board length</span>
        <InchField value={shared.boardLength} onChange={(v) => setShared({ boardLength: v })} />
        <span className="t-label t-upper text-[var(--r-ink-mute)]">End border</span>
        <InchField value={shared.endBorder} onChange={(v) => setShared({ endBorder: v })} />
        <span className="text-[var(--r-ink-mute)]">all units are inches</span>
      </div>
      <table className="face-mono text-[12px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="t-label t-upper text-left text-[var(--r-ink-mute)]">
            {IN.map((c) => (
              <th key={c.key} className="px-2 py-1 font-normal">
                {c.label}
              </th>
            ))}
            {[
              "Middle avail",
              "Middle dim",
              "Free % (pre)",
              "Derate",
              "Free %",
              "Actual in²",
              "",
            ].map((h) => (
              <th key={h} className="px-2 py-1 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const g = solve(r);
            const bad = g.slack < -1e-9;
            return (
              <tr
                key={i}
                className="border-t align-middle"
                style={{ borderColor: "var(--r-line)" }}
              >
                {IN.map((c) => (
                  <td key={c.key} className="px-2 py-1">
                    <InchField
                      int={c.int}
                      value={r[c.key]}
                      onChange={(v) => set(i, { [c.key]: v })}
                    />
                  </td>
                ))}
                <td className="px-2">{frac(g.middleAvailable)}</td>
                <td className="px-2" style={{ color: bad ? "var(--r-danger,#c0392b)" : undefined }}>
                  {frac(g.middleDimension)}
                  {bad && " ✕"}
                </td>
                <td className="px-2">{pct(g.freeAreaBeforeDerate)}</td>
                <td className="px-2">{g.lengthDerate.toFixed(3)}</td>
                <td className="px-2 font-bold text-[var(--r-ink)]">{pct(g.freeArea)}</td>
                <td className="px-2">{g.actualFreeArea.toFixed(2)}</td>
                <td className="px-2">
                  <Board g={g} px={8} dims={false} />
                </td>
                <td>
                  <button
                    type="button"
                    className="px-1 text-[var(--r-ink-mute)]"
                    title="remove row"
                    onClick={() => setRows(rows.filter((_, k) => k !== i))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="face-mono self-start rounded border px-2 py-1 text-[12px]"
        style={{ borderColor: "var(--r-line)" }}
        onClick={() => setRows([...rows, { ...(rows[rows.length - 1] ?? SHEET_ROWS[0]!) }])}
      >
        + row
      </button>
    </div>
  );
}
