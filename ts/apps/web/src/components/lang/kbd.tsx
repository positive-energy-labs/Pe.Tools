import type { ReactNode } from "react";
import { chordLabel } from "@pe/kit/keys";

/**
 * A key or chord. Pass a registered chord as `hotkey` ("Mod+K") and it prints the way this
 * platform spells it (Ctrl+K on Windows, ⌘ K on macOS); `children` is for a literal key word.
 */
export function Kbd({
  mute,
  hotkey,
  children,
}: { mute?: boolean } & (
  | { hotkey: string; children?: never }
  | { hotkey?: never; children: ReactNode }
)) {
  return (
    // Quiet by default: a hairline, no ground, the small rung in the sans face (a key is named, not
    // measured) so a hint never outweighs the verb beside it.
    <kbd
      className={`t-small inline-flex h-[calc(var(--item-h)-4px)] shrink-0 font-sans items-center justify-center rounded-sm border border-line px-1.5 ${
        mute ? "text-ink-mute" : "text-ink-2"
      }`}
    >
      {hotkey === undefined ? children : chordLabel(hotkey)}
    </kbd>
  );
}
