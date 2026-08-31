import * as React from "react";

import { tv, type VariantProps } from "#/lib/tv";

export const textareaRecipe = tv({
  base: "flex field-sizing-content w-full resize-none rounded-md border border-line bg-line/20 px-2 py-2 t-prose transition-colors outline-none placeholder:text-ink-2 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-caution aria-invalid:ring-2 aria-invalid:ring-caution/20 md:t-value dark:bg-line/30 dark:aria-invalid:border-caution/50 dark:aria-invalid:ring-caution/40",
  variants: {
    size: { compact: "min-h-9", normal: "min-h-16", tall: "min-h-32" },
    surface: {
      field: "",
      embedded: "rounded-none border-0 bg-transparent dark:bg-transparent",
    },
  },
  defaultVariants: { size: "normal", surface: "field" },
});

function Textarea({
  size,
  surface,
  ...props
}: Omit<React.ComponentProps<"textarea">, "className"> & VariantProps<typeof textareaRecipe>) {
  return <textarea data-slot="textarea" className={textareaRecipe({ size, surface })} {...props} />;
}

export { Textarea };
