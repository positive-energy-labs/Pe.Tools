/** Neutral machinery control. Its closed recipe owns every visual choice; consumers supply
 * meaning through variants and may wrap it only for one-off geometry. */
import { tv, type VariantProps } from "#/lib/tv";

import "./lang.css";

export const pressRecipe = tv({
  base: "cursor-pointer appearance-none enabled:hover:veil focus-visible:veil focus-visible:outline focus-visible:outline-line-2 disabled:cursor-not-allowed",
  variants: {
    tone: {
      bare: "",
      neutral: "text-ink",
      quiet: "text-ink-2 enabled:hover:text-ink",
      muted: "text-ink-mute enabled:hover:text-ink",
      bordered: "border border-line bg-transparent text-ink",
      "bordered-quiet": "border border-line bg-transparent text-ink-2 enabled:hover:text-ink",
      firm: "border border-line-2 bg-transparent text-ink-2 enabled:hover:bg-recess",
      artifact: "border border-line bg-artifact text-ink",
      document: "border border-line bg-document text-ink",
      link: "text-ink enabled:hover:underline",
      pea: "border border-pea text-pea-ink",
      caution: "border border-caution text-caution",
      locate: "border border-transparent enabled:hover:border-ink",
      "locate-line": "border border-line enabled:hover:border-ink",
      "locate-viz": "border border-viz-4 enabled:hover:border-ink",
      input: "text-ink shadow-none disabled:pointer-events-none disabled:opacity-50",
    },
    size: {
      auto: "",
      caption: "t-caption",
      label: "t-label",
      value: "t-value",
      title: "t-title",
      "mono-caption": "face-mono t-caption",
      "mono-label": "face-mono t-label",
      "mono-value": "face-mono t-value",
      xs: "inline-flex h-5 items-center justify-center rounded-sm px-1 t-caption",
      sm: "inline-flex h-6 items-center justify-center rounded-md px-2 t-value",
      md: "inline-flex h-7 items-center justify-center rounded-md px-2 t-value",
      "icon-xs":
        "inline-flex size-5 shrink-0 items-center justify-center rounded-sm [&>svg]:pointer-events-none [&>svg]:shrink-0",
      "icon-sm":
        "inline-flex size-6 shrink-0 items-center justify-center rounded-sm [&>svg]:pointer-events-none [&>svg]:shrink-0",
      "icon-md":
        "inline-flex size-7 shrink-0 items-center justify-center rounded-sm [&>svg]:pointer-events-none [&>svg]:shrink-0",
      "chip-caption": "inline-flex items-center rounded-sm px-1.5 py-0.5 face-mono t-caption",
      "chip-label": "inline-flex items-center rounded-sm px-1.5 py-0.5 face-mono t-label",
      "chip-value": "inline-flex items-center rounded-sm px-2 py-0.5 face-mono t-value",
      drop: "px-6 py-12",
    },
    state: {
      rest: "",
      selectable: "aria-pressed:bg-select aria-pressed:text-ink",
      selected: "bg-select text-ink",
      expanded: "aria-expanded:bg-recess aria-expanded:text-ink",
      highlighted: "bg-recess text-ink",
      emphasis: "font-semibold text-ink",
      subdued: "opacity-55",
      "disabled-faint": "disabled:opacity-40 disabled:italic",
      "row-action":
        "opacity-0 transition-opacity group-hover/row:opacity-100 data-selected:opacity-100",
      "row-action-inline": "hidden group-hover/row:inline",
      focused: "z-raised border-2 border-ink",
      "focused-caution": "z-raised border-2 border-caution",
    },
    layout: {
      auto: "",
      row: "flex w-full items-center gap-2 px-2 py-1.5 text-left",
      baseline: "flex w-full items-baseline gap-2 px-2 py-0.5 text-left",
      stack: "flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left",
      block: "block w-full text-left",
    },
  },
  defaultVariants: { tone: "bare", size: "auto", state: "rest", layout: "auto" },
});

export type PressProps = Omit<React.ComponentProps<"button">, "className" | "size"> &
  VariantProps<typeof pressRecipe>;

export function Press({ type, tone, size, state, layout, ...props }: PressProps) {
  return (
    <button
      type={type ?? "button"}
      className={pressRecipe({ tone, size, state, layout })}
      {...props}
    />
  );
}
