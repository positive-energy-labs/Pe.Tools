/**
 * The pane's one strip (ledger 2026-10-21): modes as one segmented control (exclusive), floaters as
 * toggle buttons that show open or closed, layers as toggle chips. Every option's chord binds
 * through `useScopeKeys` on the pane's own scope node, so Help lists it; a hidden pane binds none.
 * When the header's trail overflows, the strip folds: layers into one popover, then floaters into
 * one, then mode labels to their first letter, and last the trail drops under the title (pane.css),
 * so a breadcrumb title is never cut to a letter. Chords bind the same folded or not.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { useScopeKeys, useScopeLive, type Chord, type ScopeKey } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";
import { Popover, PopoverContent, PopoverTrigger } from "@pe/kit/lang/popover";

import type { FloaterSpec } from "./floater";
import { Switcher } from "./switcher";

export interface StripOption {
  key: string;
  label: string;
  chord?: Chord;
  says?: string;
}

interface PaneModes {
  value: string;
  options: readonly StripOption[];
  onChange(key: string): void;
  label?: string;
}

interface PaneLayers {
  value: readonly string[];
  options: readonly StripOption[];
  onToggle(key: string): void;
}

export interface PaneStripProps {
  modes?: PaneModes;
  floaters?: readonly FloaterSpec[];
  layers?: PaneLayers;
}

/** 0 whole; 1 layers folded; 2 floaters folded too; 3 mode labels shortened too; 4 on its own line. */
const FOLDS = 4;

/** The title lane must keep this many controls' heights (about a three-part breadcrumb). */
const TITLE_ROOM = 7;

/**
 * The title takes priority over the trail: fold controls while either lane or the title itself
 * is clipped. Only a width change unfolds them, so changing selection cannot expand the trail.
 */
function crowded(strip: HTMLElement) {
  const trail = strip.closest<HTMLElement>("[data-slot='rail-actions']") ?? strip.parentElement;
  const rail = strip.closest<HTMLElement>("[data-slot='rail']");
  const lane = rail?.querySelector<HTMLElement>("[data-slot='rail-lead']");
  const title = lane?.querySelector<HTMLElement>("[data-slot='pane-title']");
  const room = title
    ? parseFloat(getComputedStyle(title).getPropertyValue("--control-h")) * TITLE_ROOM
    : 0;
  return (
    (trail != null && trail.scrollWidth > trail.clientWidth) ||
    (lane != null && lane.scrollWidth > lane.clientWidth) ||
    (title != null && title.scrollWidth > title.clientWidth) ||
    (lane != null && lane.clientWidth < room)
  );
}

/** Folds one step per layout while the header is crowded; a resize starts over at whole. */
function useFold() {
  const ref = useRef<HTMLDivElement>(null);
  const [fold, setFold] = useState(0);
  // A width change starts over; content changes can only make more room for identity.
  useLayoutEffect(() => {
    if (ref.current && fold < FOLDS && crowded(ref.current)) setFold(fold + 1);
  });
  useLayoutEffect(() => {
    const rail = ref.current?.closest("[data-slot='rail']");
    if (!rail || typeof ResizeObserver === "undefined") return;
    // Width only: the last fold changes the rail's height, which must not unfold it again.
    let width = rail.clientWidth;
    const observer = new ResizeObserver(() => {
      if (rail.clientWidth === width) return;
      width = rail.clientWidth;
      setFold(0);
    });
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);
  return [ref, fold] as const;
}

function Folded({ label, count, children }: { label: string; count: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger kind="framed" className="t-small">
        {label} <span className="face-mono">{count}</span>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={label} className="flex w-auto flex-col gap-1 p-1">
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function PaneStrip({ modes, floaters, layers }: PaneStripProps) {
  const live = useScopeLive();
  const [ref, fold] = useFold();
  const bind = (option: StripOption, run: () => void): ScopeKey[] =>
    option.chord == null
      ? []
      : [
          {
            hotkey: option.chord,
            label: option.label,
            says: option.says,
            callback: run,
            available: () => live,
          },
        ];
  useScopeKeys([
    ...(modes?.options.flatMap((o) => bind(o, () => modes.onChange(o.key))) ?? []),
    ...(floaters?.flatMap((f) => bind(f, () => f.onOpenChange(!f.open))) ?? []),
    ...(layers?.options.flatMap((o) => bind(o, () => layers.onToggle(o.key))) ?? []),
  ]);
  const floaterButtons = floaters?.map((f) => (
    <Button
      key={f.key}
      label={f.label}
      reason={f.says}
      pressed={f.open}
      onClick={() => f.onOpenChange(!f.open)}
    >
      {f.label}
    </Button>
  ));
  const layerButtons = layers?.options.map((o) => (
    <Button
      key={o.key}
      kind="framed"
      label={o.label}
      reason={o.says}
      pressed={layers.value.includes(o.key)}
      onClick={() => layers.onToggle(o.key)}
    >
      {o.label}
    </Button>
  ));
  return (
    <div ref={ref} data-slot="pane-strip" data-fold={fold} className="flex shrink-0 items-center">
      {modes && (
        <Switcher
          ariaLabel={modes.label ?? "mode"}
          value={modes.value}
          onChange={modes.onChange}
          options={modes.options.map((o) => ({
            value: o.key,
            label:
              fold < 3 ? (
                o.label
              ) : (
                <>
                  <span aria-hidden>{o.label.slice(0, 1)}</span>
                  <span className="sr-only">{o.label}</span>
                </>
              ),
            title: fold < 3 ? (o.says ?? o.label) : o.says ? `${o.label}: ${o.says}` : o.label,
          }))}
        />
      )}
      {floaters &&
        floaters.length > 0 &&
        (fold < 2 ? (
          <span role="group" aria-label="floaters" className="flex items-center gap-1">
            {floaterButtons}
          </span>
        ) : (
          <Folded
            label="floaters"
            count={`${floaters.filter((f) => f.open).length}/${floaters.length}`}
          >
            {floaterButtons}
          </Folded>
        ))}
      {layers &&
        (fold < 1 ? (
          <span role="group" aria-label="layers" className="flex items-center gap-1">
            {layerButtons}
          </span>
        ) : (
          <Folded label="layers" count={`${layers.value.length}/${layers.options.length}`}>
            {layerButtons}
          </Folded>
        ))}
    </div>
  );
}
