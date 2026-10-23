/** Stage bindings teach the same keys the picture answers, never a second legend list. */
import { chordLabel, useScopeKeys, type ScopeKey, type ScopeGesture } from "@pe/kit/keys";
import { ORBIT_GESTURES } from "./gestures";

export function useStageKeys(
  keys: readonly ScopeKey[],
  escape: ScopeKey,
  body: HTMLElement | null,
  orbit: boolean,
): readonly ScopeGesture[] {
  useScopeKeys(keys);
  useScopeKeys([escape], body);
  return [
    ...(orbit ? ORBIT_GESTURES : []),
    ...keys
      .filter((key) => key.available?.() !== false)
      .map((key) => ({ keys: [chordLabel(key.hotkey)], label: key.says ?? key.label })),
    { keys: ["Esc"], label: escape.label },
    { keys: ["Alt", "← / →"], label: "back / forward (also mouse buttons 3 / 4)" },
  ];
}
