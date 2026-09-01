/** A control with meaning but no call-site styling. Parents own row, stack, and fill geometry. */
import { tv, type VariantProps } from "#/lib/tv";

import "./lang.css";

export const pressRecipe = tv({
  base: "cursor-pointer appearance-none border border-transparent bg-transparent focus-visible:veil focus-visible:outline focus-visible:outline-line-2 disabled:cursor-not-allowed",
  variants: {
    hover: {
      veil: "enabled:hover:veil",
      // A press whose hover ground would read as meaning (table headers on recess) keeps the
      // ink shift from its tone and no veil (takeoffs annotations, 2026-08-31).
      bare: "",
    },
    frame: {
      none: "",
      // A press floating in pane-toolbar chrome reads as furniture without an edge; the frame
      // recolors the border every press already carries (takeoffs annotations, 2026-08-31). A
      // frame also owns its INSET — a border at zero inset reads as a tight box — and takes the
      // item height so a framed press sits level with the row-shaped controls beside it
      // (annotation round, 2026-08-31).
      line: "inline-flex h-(--item-h) items-center border-line px-1",
    },
    tone: {
      neutral: "text-ink",
      quiet: "text-ink-2 enabled:hover:text-ink",
      nav: "text-nav enabled:hover:underline enabled:hover:underline-offset-3",
      agent: "text-pea-ink pea-wash",
    },
    size: {
      caption: "t-caption",
      label: "t-label",
      value: "t-value",
      title: "t-title",
      icon: "inline-flex size-6 shrink-0 items-center justify-center rounded-sm [&>svg]:pointer-events-none [&>svg]:shrink-0",
    },
    state: {
      rest: "",
      selected: "text-ink",
      disabled: "disabled:opacity-40 disabled:italic",
      focused: "z-raised outline-2 outline-ink",
    },
  },
  defaultVariants: { tone: "neutral", size: "label", state: "rest", hover: "veil", frame: "none" },
});

export type PressProps = Omit<React.ComponentProps<"button">, "className" | "size"> &
  VariantProps<typeof pressRecipe>;

export function Press({ type, tone, size, state, hover, frame, ...props }: PressProps) {
  return (
    <button
      type={type ?? "button"}
      className={pressRecipe({ tone, size, state, hover, frame })}
      data-selected={state === "selected" ? "" : undefined}
      {...props}
    />
  );
}
