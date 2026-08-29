/** A control with meaning but no call-site styling. Parents own row, stack, and fill geometry. */
import { tv, type VariantProps } from "#/lib/tv";

import "./lang.css";

export const pressRecipe = tv({
  base: "cursor-pointer appearance-none border border-transparent bg-transparent enabled:hover:veil focus-visible:veil focus-visible:outline focus-visible:outline-line-2 disabled:cursor-not-allowed aria-pressed:bg-select aria-expanded:bg-select",
  variants: {
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
      selected: "bg-select text-ink",
      disabled: "disabled:opacity-40 disabled:italic",
      focused: "z-raised outline-2 outline-ink",
    },
  },
  defaultVariants: { tone: "neutral", size: "label", state: "rest" },
});

export type PressProps = Omit<React.ComponentProps<"button">, "className" | "size"> &
  VariantProps<typeof pressRecipe>;

export function Press({ type, tone, size, state, ...props }: PressProps) {
  return (
    <button type={type ?? "button"} className={pressRecipe({ tone, size, state })} {...props} />
  );
}
