/**
 * The pane's one strip (ledger 2026-10-21): modes as one segmented control (exclusive), floaters as
 * toggle buttons that show open or closed, layers as toggle chips. Every option's chord binds
 * through `useScopeKeys` on the pane's own scope node, so Help lists it; a hidden pane binds none.
 * The rail's container queries fold the strip: layers into one popover, then floaters into
 * one, then mode labels to their first letter, and last the trail drops under the title (pane.css),
 * so a breadcrumb title is never cut to a letter. Chords bind the same folded or not.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useScopeKeys, useScopeLive, type Chord, type ScopeKey } from "../../keys";
import { Button } from "./button";
import { ButtonGroup } from "./button-group";
import { Popover, PopoverContent, PopoverTrigger } from "./popover-internal";

import type { FloaterSpec } from "./floater";
import { Switcher } from "./switcher";
import { TeachOwner, useTeach } from "./use-teach";

export interface StripOption {
  key: string;
  label: string;
  chord?: Chord;
  says?: string;
  busy?: boolean;
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

function Folded({ label, count, children }: { label: string; count: string; children: ReactNode }) {
  const owner = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // CSS owns folding; close a popup when its trigger leaves the visible layout.
  useEffect(() => {
    if (!open || !owner.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) setOpen(false);
    });
    observer.observe(owner.current);
    return () => observer.disconnect();
  }, [open]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger ref={owner} kind="framed" className="t-small">
        {label} <span className="face-mono">{count}</span>
      </PopoverTrigger>
      <PopoverContent
        keepMounted
        align="end"
        aria-label={label}
        className="flex w-auto flex-col gap-1 p-1"
      >
        <TeachOwner value={owner}>{children}</TeachOwner>
      </PopoverContent>
    </Popover>
  );
}

export function PaneStrip({
  modes,
  floaters,
  layers,
  projection,
}: PaneStripProps & { projection?: ReactNode }) {
  const live = useScopeLive();
  useTeach({
    kind: "views",
    label: "views and layers",
    options: [
      ...(floaters?.map((f) => ({
        key: f.key,
        label: f.label,
        says: f.says,
        active: f.open,
        place: f.place,
      })) ?? []),
      ...(layers?.options.map((o) => ({
        key: o.key,
        label: o.label,
        says: o.says,
        active: layers.value.includes(o.key),
      })) ?? []),
    ],
  });
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
      busy={o.busy}
      pressed={layers.value.includes(o.key)}
      onClick={() => layers.onToggle(o.key)}
    >
      {o.label}
    </Button>
  ));
  return (
    <div data-slot="pane-strip" className="flex shrink-0 items-center">
      {modes && (
        <span data-strip-modes="">
          <Switcher
            ariaLabel={modes.label ?? "mode"}
            value={modes.value}
            onChange={modes.onChange}
            options={modes.options.map((o) => ({
              value: o.key,
              label: (
                <>
                  <span data-strip-label="full" aria-hidden>
                    {o.label}
                  </span>
                  <span data-strip-label="short" aria-hidden>
                    {o.label.slice(0, 1)}
                  </span>
                  <span className="sr-only">{o.label}</span>
                </>
              ),
              title: o.says ? `${o.label}: ${o.says}` : o.label,
            }))}
          />
        </span>
      )}
      {floaters && floaters.length > 0 && (
        <div data-strip-group="floaters">
          <div data-strip-full="">
            <ButtonGroup label="floaters">{floaterButtons}</ButtonGroup>
          </div>
          <div data-strip-folded="">
            <Folded
              label="floaters"
              count={`${floaters.filter((f) => f.open).length}/${floaters.length}`}
            >
              {floaterButtons}
            </Folded>
          </div>
        </div>
      )}
      {(layers || projection) && (
        <div data-strip-group="layers">
          <div data-strip-full="">
            <ButtonGroup label="layers">
              {projection}
              {layerButtons}
            </ButtonGroup>
          </div>
          <div data-strip-folded="">
            <Folded
              label="layers"
              count={layers ? `${layers.value.length}/${layers.options.length}` : ""}
            >
              {projection}
              {layerButtons}
            </Folded>
          </div>
        </div>
      )}
    </div>
  );
}
