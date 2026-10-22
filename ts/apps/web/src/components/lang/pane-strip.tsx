/**
 * The pane's one strip (ledger 2026-10-21): modes as one segmented control (exclusive), floaters as
 * toggle buttons that show open or closed, layers as toggle chips. Every option's chord binds
 * through `useScopeKeys` on the pane's own scope node, so Help lists it; a hidden pane binds none.
 */
import { useScopeKeys, useScopeLive, type Chord, type ScopeKey } from "@pe/kit/keys";
import { Button } from "@pe/kit/lang/button";

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

export function PaneStrip({ modes, floaters, layers }: PaneStripProps) {
  const live = useScopeLive();
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
  return (
    <div data-slot="pane-strip" className="flex shrink-0 items-center gap-1">
      {modes && (
        <Switcher
          ariaLabel={modes.label ?? "mode"}
          value={modes.value}
          onChange={modes.onChange}
          options={modes.options.map((o) => ({
            value: o.key,
            label: o.label,
            title: o.says ?? o.label,
          }))}
        />
      )}
      {floaters && floaters.length > 0 && (
        <span role="group" aria-label="floaters" className="flex items-center gap-1">
          {floaters.map((f) => (
            <Button
              key={f.key}
              label={f.label}
              reason={f.says}
              pressed={f.open}
              onClick={() => f.onOpenChange(!f.open)}
            >
              {f.label}
            </Button>
          ))}
        </span>
      )}
      {layers && (
        <span role="group" aria-label="layers" className="flex items-center gap-1">
          {layers.options.map((o) => (
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
          ))}
        </span>
      )}
    </div>
  );
}
