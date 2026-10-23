/**
 * The keys every 3D stage answers the same way (SURFACE-PHILOSOPHY N2: one input vocabulary for the
 * app). A stage's legend and its tutorial read this list, then add only the keys of its own.
 */
import { POINTER_WORD } from "@pe/kit/lang/gesture-glyph";
import type { LegendKey } from "@pe/kit/lang/key-hint";
import { ORBIT_GESTURES } from "./gestures";

export const STAGE_KEYS: readonly LegendKey[] = [
  // The pointer lines are the scheme's own declaration (gestures.ts).
  ...ORBIT_GESTURES.map(({ keys, pointer, label }) => ({
    keys,
    pointer: pointer && POINTER_WORD[pointer],
    does: label,
  })),
  { pointer: "right click", does: "Select or Selection Box in Revit" },
  { keys: ["B", "X"], does: "Selection Box under the pointer" },
  {
    keys: ["Alt", "←"],
    does: "back to the previous selection and view (also the mouse's back button)",
  },
  { keys: ["Alt", "→"], does: "forward again" },
  { keys: ["F"], does: "frame the selection; nothing selected fits the whole" },
  { keys: ["P"], does: "plan or isometric, keeping the pivot and zoom" },
  { keys: ["N"], does: "look north (also N on the globe's rim)" },
  { keys: ["G"], does: "show or hide the globe" },
  { keys: ["Esc"], does: "clear the selection" },
];
