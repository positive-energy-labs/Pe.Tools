import * as React from "react";

import { tv, type VariantProps } from "#/lib/tv";

export const textareaRecipe = tv({
  base: "flex field-sizing-content w-full resize-none rounded-control border border-line bg-line/20 px-(--control-pad-x) py-2 transition-colors outline-none placeholder:text-ink-2 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-caution aria-invalid:ring-2 aria-invalid:ring-caution dark:bg-line/30",
  variants: {
    size: { compact: "min-h-9", normal: "min-h-16", tall: "min-h-32" },
    surface: {
      field: "t-small",
      // Embedded in a frame that owns focus (the composer box rings itself): no ring of its own.
      embedded: "t-prose rounded-none border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent",
    },
  },
  defaultVariants: { size: "normal", surface: "field" },
});

function Textarea({
  size,
  surface,
  face,
  ...props
}: Omit<React.ComponentProps<"textarea">, "className"> &
  VariantProps<typeof textareaRecipe> & { face?: "mono" }) {
  return (
    <textarea
      data-slot="textarea"
      className={`${textareaRecipe({ size, surface })}${face === "mono" ? " face-mono" : ""}`}
      {...props}
    />
  );
}

export { Textarea };
