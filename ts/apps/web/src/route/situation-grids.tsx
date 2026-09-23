/** The Situation's grids: the ledger behind the gauge and the page log column. */
import { useState, type ReactNode } from "react";
import { Switcher } from "#/components/lang/switcher";
import { Inspect, inspectableOf } from "./inspect";
import type { RouteManifest } from "./manifest";
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

/**
 * The page log column, newest first. Its head is the title and one tab per kind (all, each
 * reading, work, target); a verb belongs to a reading when its action dirties it. A tab with no
 * entries is not drawn. A row is the entry's label; hover says when and what it said.
 */
export function PageLog({
  entries,
  manifest,
}: {
  entries: readonly LogEntry[];
  manifest: RouteManifest<any, any, any, any>;
}) {
  const [picked, setPicked] = useState("all");
  const actions = (manifest.actions ?? {}) as Record<string, { dirties?: readonly string[] }>;
  const tabOf = (entry: LogEntry) =>
    entry.kind === "verb" ? (actions[entry.action ?? ""]?.dirties ?? []) : [entry.kind];
  // A reading named `work` and the work kind are one tab.
  const tabs = [
    ...new Set(["all", ...Object.keys(manifest.readings ?? {}), "work", "target"]),
  ].filter((tab) => tab === "all" || entries.some((entry) => tabOf(entry).includes(tab)));
  const tab = tabs.includes(picked) ? picked : "all";
  const shown = tab === "all" ? entries : entries.filter((entry) => tabOf(entry).includes(tab));
  return (
    <div className="flex flex-col">
      <div className="flex h-(--item-h) items-center gap-2">
        <Label>log</Label>
        {tabs.length > 1 ? (
          <Switcher
            ariaLabel="log kind"
            value={tab}
            onChange={setPicked}
            options={tabs.map((value) => ({ value, label: value, title: `${value} entries` }))}
          />
        ) : null}
      </div>
      <ul className="hairline-t mt-1.5 h-24 overflow-y-auto pt-1 t-prose">
        {shown.map((entry, index) => (
          <li
            key={index}
            title={`${entry.at} · ${entry.says}`}
            data-tone={entry.refused ? "caution" : undefined}
            className="flex min-w-0 gap-2 truncate"
          >
            <span className={entry.refused ? "" : "text-ink"}>
              {entry.link && inspectableOf(manifest.inspectables, entry.link.kind) ? (
                <Inspect
                  spec={inspectableOf(manifest.inspectables, entry.link.kind)!}
                  id={entry.link.id}
                >
                  {entry.label}
                </Inspect>
              ) : (
                entry.label
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
