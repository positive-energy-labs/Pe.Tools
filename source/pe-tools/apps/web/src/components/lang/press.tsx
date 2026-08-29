/**
 * PRESS — the neutral machinery control: a tab, a disclosure, a sort header, a close ×.
 * `Verb` is the control that ACTS and owns the tone budget; `Press` mints no tone and draws no
 * layout (the call site keeps its own padding, ground and type). A control that has earned a
 * tone is a `Verb`, not a dressed-up `Press`.
 *
 * Invariants it owns: a real `<button>` (Enter/Space, role, form participation); `type`
 * defaulted to `"button"` so a control inside a form is never an accidental submit; the ONE
 * HOVER LAW's veil, focus ring and `not-allowed` disabled cursor via `pressRecipe`;
 * and pass-through of `ref`, handlers, `disabled` and aria — nothing here intercepts them.
 *
 * The ground/type/border reset stays out of the base recipe. Closed variants own earned marks.
 */
import { tv, type VariantProps } from "#/lib/tv";

import "./lang.css";

export const pressRecipe = tv({
  base: "cursor-pointer appearance-none enabled:hover:veil focus-visible:veil focus-visible:outline focus-visible:outline-line-2 disabled:cursor-not-allowed",
  variants: {
    tone: {
      bare: "",
      neutral: "text-ink hover:veil",
      quiet: "text-ink-2 hover:text-ink",
      bordered: "border border-line bg-artifact text-ink hover:veil",
    },
    size: {
      auto: "",
      xs: "inline-flex h-5 items-center justify-center rounded-sm px-1 t-caption",
      sm: "inline-flex h-6 items-center justify-center rounded-md px-2 t-value",
      md: "inline-flex h-7 items-center justify-center rounded-md px-2 t-value",
      "icon-xs":
        "inline-flex size-5 shrink-0 items-center justify-center rounded-sm [&>svg]:pointer-events-none [&>svg]:shrink-0",
      "icon-sm":
        "inline-flex size-6 shrink-0 items-center justify-center rounded-sm [&>svg]:pointer-events-none [&>svg]:shrink-0",
      "icon-md":
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm [&>svg]:pointer-events-none [&>svg]:shrink-0",
      row: "flex w-full items-center gap-2 px-2 py-1.5 text-left",
    },
    state: {
      rest: "",
      selectable: "aria-pressed:bg-select aria-pressed:text-ink",
    },
  },
  defaultVariants: { tone: "bare", size: "auto", state: "rest" },
});

export type PressProps = Omit<React.ComponentProps<"button">, "size"> &
  VariantProps<typeof pressRecipe> & {
    /** Compatibility for callers outside this migration's component scope. */
    className?: string;
    /** Icon-only alias while callers move to `size="icon-*"`. */
    icon?: boolean;
  };

export function Press({ className, type, icon, tone, size, state, ...props }: PressProps) {
  return (
    <button
      type={type ?? "button"}
      className={pressRecipe({
        tone,
        size: icon === true && size == null ? "icon-sm" : size,
        state,
        className,
      })}
      {...props}
    />
  );
}
