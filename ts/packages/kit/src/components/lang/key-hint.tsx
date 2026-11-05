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
