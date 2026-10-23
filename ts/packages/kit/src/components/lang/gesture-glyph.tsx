import { KeyHint } from "./key-hint";
import type { PointerKind } from "../../keys";

/** What help and legends call each pointer action. */
export const POINTER_WORD: Record<PointerKind, string> = {
  drag: "drag",
  "right-drag": "right drag",
  wheel: "wheel",
  pinch: "pinch",
  scroll: "scroll",
  click: "click",
  "double-click": "double-click",
  hover: "hover",
};

const BUTTON: Partial<Record<PointerKind, "left" | "right" | "wheel">> = {
  drag: "left",
  click: "left",
  "double-click": "left",
  "right-drag": "right",
  wheel: "wheel",
  scroll: "wheel",
};

/**
 * A mouse seen from above with the part in use filled: the one mark for "this is a pointer, not a
 * key". Pinch has no mouse part, so it draws two facing arrows instead. It frames nothing.
 */
export function GestureGlyph({ pointer }: { pointer: PointerKind }) {
  const part = BUTTON[pointer];
  return (
    <svg
      width={14}
      height={16}
      viewBox="0 0 14 16"
      role="img"
      aria-label={POINTER_WORD[pointer]}
      data-gesture={pointer}
      className="shrink-0 text-ink-2"
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
    >
      {pointer === "pinch" ? (
        <path d="M2 14 6 10M2 10v4h4M12 2 8 6M12 6V2H8" />
      ) : (
        <>
          <rect x={2.5} y={1.5} width={9} height={13} rx={4.5} />
          <path d="M2.5 7h9M7 1.5V7" />
          {part === "left" ? <path d="M3 7V6a4 4 0 0 1 4-4v5z" fill="currentColor" /> : null}
          {part === "right" ? <path d="M11 7V6a4 4 0 0 0-4-4v5z" fill="currentColor" /> : null}
          {part === "wheel" ? <rect x={6} y={3} width={2} height={4} fill="currentColor" /> : null}
        </>
      )}
    </svg>
  );
}

/**
 * The left cell of a gesture's row: held keys (each a `KeyHint`), the pointer glyph with its word,
 * or keys alone for a native widget's own. The same cell wherever gestures are listed.
 */
export function GestureKey({
  pointer,
  keys = [],
}: {
  pointer?: PointerKind;
  keys?: readonly string[];
}) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap" data-gesture-key="">
      {keys.map((key, i) => (
        <KeyHint key={`${key}-${i}`}>{key}</KeyHint>
      ))}
      {keys.length && pointer ? <span className="text-ink-mute">+</span> : null}
      {pointer ? (
        <>
          <GestureGlyph pointer={pointer} />
          <span className="text-ink-2">{POINTER_WORD[pointer]}</span>
        </>
      ) : null}
    </span>
  );
}
