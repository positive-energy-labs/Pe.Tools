import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { tv } from "#/lib/tv";

export const inputRecipe = tv({
  base: "h-(--control-h) w-full min-w-0 rounded-md border border-line bg-line/20 px-2 py-0.5 t-prose transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:t-value file:font-medium file:text-ink placeholder:text-ink-2 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-caution aria-invalid:ring-2 aria-invalid:ring-caution/20 md:t-value dark:bg-line/30 dark:aria-invalid:border-caution/50 dark:aria-invalid:ring-caution/40",
  variants: {
    surface: {
      field: "",
      embedded:
        "flex-1 rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent",
    },
  },
  defaultVariants: { surface: "field" },
});

function Input({
  type,
  surface,
  ...props
}: Omit<React.ComponentProps<"input">, "className"> &
  import("#/lib/tv").VariantProps<typeof inputRecipe>) {
  return (
    <InputPrimitive type={type} data-slot="input" className={inputRecipe({ surface })} {...props} />
  );
}

export { Input };
