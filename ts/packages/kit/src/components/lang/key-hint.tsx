import type { ReactNode } from "react";
import { chordLabel, type Chord } from "../../keys";

/** A quiet key label shared by menus, help, and controls. */
export function KeyHint({
  mute,
  hotkey,
  children,
}: { mute?: boolean } & (
  | { hotkey: Chord; children?: never }
  | { hotkey?: never; children: ReactNode }
)) {
  return (
    <kbd
      className={`t-small inline-flex h-[calc(var(--item-h)-4px)] shrink-0 items-center justify-center rounded-sm border border-line px-1.5 font-sans ${mute ? "text-ink-mute" : "text-ink-2"}`}
    >
      {hotkey === undefined ? children : chordLabel(hotkey as Chord)}
    </kbd>
  );
}

import { Fragment, useState } from "react";
import { useScopeKeys } from "../../keys";

import { tokenRef } from "../../lib/token";

/**
 * One line of a key legend: the keys held (each a `KeyHint`), then the pointer gesture (a plain word:
 * a mouse is not a key, so it never wears the key's hairline), then what it does.
 */
export interface LegendKey {
  keys?: readonly string[];
  pointer?: string;
  does: string;
}

function Press({ keys = [], pointer }: Omit<LegendKey, "does">) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {keys.map((key, i) => (
        <KeyHint key={`${key}-${i}`}>{key}</KeyHint>
      ))}
      {keys.length && pointer ? <span className="text-ink-mute">+</span> : null}
      {pointer ? <span className="text-ink-2">{pointer}</span> : null}
    </span>
  );
}

/**
 * `?` is Shift+/ on a US layout. The library's type refuses Shift with punctuation (the shifted
 * character moves between layouts), but its matcher reads the physical key, so `?` fires here.
 */
const LEGEND_CHORD = "Shift+/" as Chord;

function LegendKeys({ toggle }: { toggle: () => void }) {
  useScopeKeys([
    { hotkey: LEGEND_CHORD, label: "keys", says: "Show or hide the keys", callback: toggle },
  ]);
  return null;
}

/**
 * A surface's keys and gestures, quiet until asked: one line of the `lead` entries, the whole list
 * on hover or `?`. It sits on the page ground so it reads over a drawing; it frames nothing,
 * because it operates nothing. `bind={false}` leaves `?` to a caller (a specimen beside a live one).
 */
export function KeyLegend({
  keys,
  lead = 3,
  defaultOpen = false,
  bind = true,
  className = "",
}: {
  keys: readonly LegendKey[];
  lead?: number;
  defaultOpen?: boolean;
  bind?: boolean;
  className?: string;
}) {
  const [pinned, setPinned] = useState(defaultOpen);
  const [hover, setHover] = useState(false);
  const open = pinned || hover;
  return (
    <section
      aria-label="keys"
      data-key-legend={open ? "open" : "closed"}
      className={`t-small select-none rounded-sm px-2 py-1 font-sans ${className}`}
      style={{ background: tokenRef("page") }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {bind ? <LegendKeys toggle={() => setPinned((p) => !p)} /> : null}
      {open ? (
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-3">
          {keys.map((key, i) => (
            <Fragment key={`${i}:${key.does}`}>
              <span className="flex h-(--item-h) items-center justify-end">
                <Press keys={key.keys} pointer={key.pointer} />
              </span>
              <span className="whitespace-nowrap">{key.does}</span>
            </Fragment>
          ))}
          <span className="flex h-(--item-h) items-center justify-end">
            <KeyHint mute>?</KeyHint>
          </span>
          <span className="whitespace-nowrap text-ink-2">
            {pinned ? "hide the keys" : "keep the keys open"}
          </span>
        </div>
      ) : (
        <div className="flex h-(--item-h) items-center gap-3 whitespace-nowrap">
          {keys.slice(0, lead).map((key, i) => (
            <span key={`${i}:${key.does}`} className="inline-flex items-center gap-1">
              <Press keys={key.keys} pointer={key.pointer} />
              <span>{key.does}</span>
            </span>
          ))}
          <span className="inline-flex items-center gap-1 text-ink-2">
            <KeyHint mute>?</KeyHint>
            {lead && keys.length > lead ? `${keys.length - lead} more` : "keys"}
          </span>
        </div>
      )}
    </section>
  );
}
