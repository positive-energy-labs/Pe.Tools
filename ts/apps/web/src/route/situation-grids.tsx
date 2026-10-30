import { useList } from "@pe/kit/lang/collection";
import { PlainList } from "@pe/kit/lang/list-view";
/** The Situation's grids: the ledger behind the gauge and the page log column. */
import { useState, type ReactNode } from "react";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "@pe/kit/lang/switcher";
import { Inspect, inspectableOf } from "./inspect";
import type { RouteManifest } from "./manifest";
import type { LogEntry } from "#/shell/owner";
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

const CAP = 7;

/**
 * The page log column, newest first. Its head is the title and one tab per kind (all, each
 * reading, work, target); a verb belongs to a reading when its action dirties it. A tab with no
 * entries is not drawn. A row is `[at] [mark] label [link]`: ✓ a verb that ran, ✕ a refusal or
 * failure; hover says what it said. The newest 7 show until "N more" opens the rest.
 *
 * `collapsible` (the Situation head, MAP ruling 21): the column draws the tabs and the newest row
 * only, its time on hover. A click on that row or on a tab opens the tabbed column OVER what sits
 * below, so the head keeps its height and the grid under it never moves; "hide" folds it again.
 */
export function PageLog({
  entries,
  manifest,
  collapsible = false,
}: {
  entries: readonly LogEntry[];
  manifest: RouteManifest<any, any, any, any>;
  collapsible?: boolean;
}) {
  const [picked, setPicked] = useState("all");
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(!collapsible);
  const actions = (manifest.actions ?? {}) as Record<string, { dirties?: readonly string[] }>;
  const tabOf = (entry: LogEntry) =>
    entry.kind === "verb" ? (actions[entry.action ?? ""]?.dirties ?? []) : [entry.kind];
  // A reading named `work` and the work kind are one tab.
  const tabs = [
    ...new Set(["all", ...Object.keys(manifest.readings ?? {}), "work", "target"]),
  ].filter((tab) => tab === "all" || entries.some((entry) => tabOf(entry).includes(tab)));
  const tab = tabs.includes(picked) ? picked : "all";
  const shown = tab === "all" ? entries : entries.filter((entry) => tabOf(entry).includes(tab));
  const rows = !open ? shown.slice(0, 1) : all ? shown : shown.slice(0, CAP);
  const list = useList({
    items: rows,
    keyOf: (entry) => `${entry.at}:${entries.indexOf(entry)}`,
    search: (entry) => ({ text: [entry.label, entry.says] }),
    onPick: () => setOpen(true),
  });
  const column = (
    <div
      data-surface={collapsible && open ? "artifact" : undefined}
      className={
        collapsible && open
          ? "absolute inset-x-0 top-0 z-popup -mx-2 flex flex-col px-2 pb-1 shadow-float"
          : "flex flex-col"
      }
    >
      <div className="flex h-(--item-h) items-center gap-2">
        <Label>log</Label>
        {tabs.length > 1 ? (
          // Any tab press opens a folded column, the picked tab included.
          <span className="contents" onClickCapture={() => setOpen(true)}>
            <Switcher
              ariaLabel="log kind"
              value={tab}
              onChange={setPicked}
              options={tabs.map((value) => ({ value, label: value, title: `${value} entries` }))}
            />
          </span>
        ) : null}
        {/* On the title line: the head is a fixed height, so a line under the rows would be clipped. */}
        <span className="ml-auto flex items-center gap-1">
          {open && shown.length > CAP ? (
            <Button
              label={all ? "newest 7 ▴" : `${shown.length - CAP} more ▸`}
              onClick={() => setAll(!all)}
            >
              {all ? (
                "newest 7 ▴"
              ) : (
                <span className="face-mono">{`${shown.length - CAP} more ▸`}</span>
              )}
            </Button>
          ) : null}
          {collapsible && open ? (
            <Button
              label="hide ▴"
              onClick={() => {
                setOpen(false);
                setAll(false);
              }}
            >
              hide ▴
            </Button>
          ) : null}
        </span>
      </div>
      <div className={`hairline-t mt-1.5 ${open ? "h-[7lh] overflow-y-auto" : "h-[1lh]"}`}>
        <PlainList
          list={list}
          aria-label="page log"
          empty={{ message: "No log entries", exit: "Read or run an action" }}
          row={(entry) => ({
            title: `${entry.at} · ${entry.says}`,
            meta: open ? entry.at : undefined,
            lead: entry.refused ? "✕" : entry.kind === "verb" ? "✓" : "",
            label:
              entry.link && inspectableOf(manifest.inspectables, entry.link.kind) ? (
                <Inspect
                  spec={inspectableOf(manifest.inspectables, entry.link.kind)!}
                  id={entry.link.id}
                >
                  {entry.label}
                </Inspect>
              ) : (
                entry.label
              ),
          })}
        />
      </div>
    </div>
  );
  // Folded or open, the head column keeps one height; the open column floats over the grid.
  return collapsible ? <div className="relative h-full">{column}</div> : column;
}
