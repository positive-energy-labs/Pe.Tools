/** The Situation's grids: the ledger behind the gauge and the page log. */
import type { ReactNode } from "react";
import type { LogEntry } from "./route-owner";
import { Label } from "./situation-verbs";

/** Label gutter shared by every grid on the board, so columns line up across rows. */
const GUTTER = "grid grid-cols-[9rem_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1 t-prose";

/** Rows of label → value: what is bound, how fresh, which revision. */
export function Ledger({ rows }: { rows: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className={GUTTER}>
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>
            <Label>{label}</Label>
          </dt>
          <dd className="min-w-0 truncate text-ink-2">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The page log, newest first: time and kind in the gutter, then the verb and what it said. */
export function PageLog({ entries }: { entries: readonly LogEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className={`${GUTTER} max-h-48 overflow-y-auto`}>
      {entries.map((entry, index) => (
        <div key={index} className="contents" data-tone={entry.refused ? "caution" : undefined}>
          <span className="flex items-baseline justify-between gap-2 t-small">
            <span className="face-mono text-ink-mute">{entry.at}</span>
            <span className="t-upper text-ink-mute">{entry.kind}</span>
          </span>
          <span className="min-w-0 truncate">
            <span className="text-ink">{entry.label}</span>{" "}
            <span className={entry.refused ? "" : "text-ink-2"}>{entry.says}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
