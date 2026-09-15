/**
 * THE PICKER — one popover per ladder (Situation glossary). The trigger is the ladder's terminal
 * word in the sentence; the popup is the whole ladder: a breadcrumb of levels, a search that
 * picks on Enter and advances a level, option rows with a measured sub line, and the reason when
 * a level has nothing to offer. Rebuilt from the 2026-09-08 targeting kit on plain data (no
 * bindings model): a route hands it levels, the picker draws them.
 *
 * Marks: dotted underline = operable and held; dashed = empty or reported by the world, not chosen;
 * the caution hue = the ladder is incomplete or its feed disagrees.
 */
import { Popover } from "@base-ui/react/popover";
import { useEffect, useState, type ReactNode } from "react";

import { PressContent } from "#/components/anatomy/press-content";
import { Press } from "#/components/lang/press";

export interface PickOption {
  id: string;
  label: string;
  /** A measured fact beside the label (a count, a kind, a path tail). */
  sub?: string;
}

export interface PickLevel {
  key: string;
  /** What the sentence says for this level once bound; null = unbound. */
  label: string | null;
  /** The word for the empty slot ("choose a document"). */
  placeholder: string;
  /** null = this level cannot list yet; `note` says why. */
  options: readonly PickOption[] | null;
  /** Why the list is empty or missing ("reading…", "read failed", "bind a session first"). */
  note?: string;
  multi?: boolean;
  picked?: (id: string) => boolean;
  pick: (id: string) => void;
  /** Route-supplied footer under the options of this level. */
  extra?: ReactNode;
}

export function Picker({
  levels,
  derived,
  caution,
  disabled,
  title,
}: {
  levels: readonly PickLevel[];
  /** The bound value was reported by the world, not chosen (house law 8): dashed. */
  derived?: boolean;
  /** The world disagrees with the binding ("needs initialization"): caution hue. */
  caution?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState(levels[0]?.key ?? "");
  const [q, setQ] = useState("");
  const terminal = levels.at(-1);
  const next = levels.find((item) => item.label === null);
  const complete = next === undefined;
  const word = complete ? (terminal?.label ?? "") : next.placeholder;
  useEffect(() => {
    if (!open) return;
    setLevel((next ?? terminal)?.key ?? "");
    setQ("");
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const cur = levels.find((item) => item.key === level) ?? levels[0];
  const below = cur ? levels[levels.indexOf(cur) + 1] : undefined;
  const match = (o: PickOption) =>
    `${o.label} ${o.sub ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const hits = (cur?.options ?? []).filter(match);
  const belowHits =
    q && below && cur?.label && !cur.multi ? (below.options ?? []).filter(match) : [];
  const advance = (from: PickLevel) => {
    if (from.multi) return;
    const after = levels[levels.indexOf(from) + 1];
    if (after) setLevel(after.key);
    else setOpen(false);
    setQ("");
  };
  const row = (lvl: PickLevel, o: PickOption) => {
    const on = lvl.picked?.(o.id) ?? false;
    return (
      <Press
        key={`${lvl.key}:${o.id}`}
        tone="quiet"
        size="value"
        state={on ? "selected" : "rest"}
        style={{ width: "100%" }}
        onClick={() => {
          lvl.pick(o.id);
          advance(lvl);
        }}
      >
        <PressContent geometry="baseline">
          {lvl.multi ? <span className="face-mono">{on ? "☑" : "☐"}</span> : null}
          <span className="text-ink">{o.label}</span>
          {o.sub ? <span className="face-mono text-ink-2">{o.sub}</span> : null}
        </PressContent>
      </Press>
    );
  };
  const tone = caution || !complete ? "caution" : undefined;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        title={title}
        data-tone={tone}
        className="cursor-pointer border-b border-current whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderBottomStyle: derived || !complete ? "dashed" : "dotted" }}
      >
        {word}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            aria-label={`Choose ${cur?.key ?? ""}`}
            data-surface="artifact"
            className="block w-80 max-w-(--available-width) overflow-hidden rounded-lg text-ink ring-1 ring-line outline-none"
          >
            {levels.length > 1 ? (
              <div className="hairline-b flex flex-wrap items-baseline gap-1 px-2 pt-1.5 pb-1">
                {levels.map((item, i) => (
                  <span key={item.key} className="inline-flex items-baseline gap-1">
                    {i > 0 ? <span className="text-ink-mute">›</span> : null}
                    <Press
                      size="value"
                      state={item.key === cur?.key ? "selected" : "rest"}
                      data-tone={item.label === null ? "caution" : undefined}
                      style={{
                        padding: "0 3px",
                        borderBottom: `1px solid ${item.key === cur?.key ? "currentColor" : "transparent"}`,
                      }}
                      onClick={() => (setLevel(item.key), setQ(""))}
                    >
                      {item.label ?? item.placeholder}
                    </Press>
                  </span>
                ))}
              </div>
            ) : null}
            {cur && (cur.options?.length ?? 0) > 6 ? (
              <input
                autoFocus
                aria-label={`Search ${cur.key}`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && hits[0]) {
                    cur.pick(hits[0].id);
                    advance(cur);
                  }
                }}
                placeholder={`search ${cur.key} · ${cur.options?.length}`}
                className="hairline-b w-full bg-transparent px-2 py-1 text-ink outline-none"
              />
            ) : null}
            <div className="max-h-[min(16rem,calc(100dvh-6rem))] overflow-y-auto py-1">
              {!cur ? null : cur.options === null ? (
                <div className="px-2 py-1" data-tone="caution">
                  {cur.note ?? `needs ${cur.key}`}
                </div>
              ) : cur.options.length === 0 ? (
                <div className="px-2 py-1 text-ink-2">{cur.note ?? `no ${cur.key}`}</div>
              ) : hits.length === 0 ? (
                <div className="px-2 py-1 text-ink-2">no match</div>
              ) : (
                hits.map((o) => row(cur, o))
              )}
              {below && belowHits.length > 0 ? (
                <>
                  <div className="hairline-t px-2 pt-1.5 text-ink-mute">
                    {cur?.label} › {below.key}
                  </div>
                  {belowHits.map((o) => row(below, o))}
                </>
              ) : null}
              {cur?.extra}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
