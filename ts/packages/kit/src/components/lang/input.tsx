import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { tv, type VariantProps } from "../../lib/tv";

export const inputRecipe = tv({
  base: "w-full min-w-0 px-(--control-pad-x) py-0.5 t-small outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-semibold file:text-ink placeholder:text-ink-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  variants: {
    kind: {
      field: "",
      check: "size-4 w-auto shrink-0 p-0 accent-ink",
    },
    surface: {
      field: "",
      embedded: "flex-1 bg-transparent disabled:opacity-100",
    },
  },
  defaultVariants: { kind: "field", surface: "field" },
});

function Input({
  type,
  surface,
  face,
  ...props
}: Omit<React.ComponentProps<"input">, "className" | "title"> &
  import("../../lib/tv").VariantProps<typeof inputRecipe> & { face?: "mono" }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={`${inputRecipe({ kind: type === "checkbox" ? "check" : "field", surface })}${type !== "checkbox" && surface !== "embedded" ? " dl-control" : ""}${face === "mono" ? " face-mono" : ""}`}
      {...props}
    />
  );
}

export { Input };

export const labelRecipe = tv({
  base: "flex items-center gap-2 t-small font-semibold select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
});

// ponytail: base-ui has no Label primitive; a native <label> covers every use here.
function Label(props: Omit<React.ComponentProps<"label">, "className">) {
  return <label data-slot="label" className={labelRecipe()} {...props} />;
}

export { Label };

export const textareaRecipe = tv({
  base: "flex field-sizing-content w-full resize-none rounded-control border border-line bg-line/20 px-(--control-pad-x) py-2 transition-colors placeholder:text-ink-2 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-caution aria-invalid:ring-2 aria-invalid:ring-caution dark:bg-line/30",
  variants: {
    size: { compact: "min-h-9", normal: "min-h-16", tall: "min-h-32" },
    surface: {
      field: "t-small",
      // Embedded in a frame that owns focus (the composer box rings itself): no ring of its own.
      embedded: "t-prose rounded-none border-0 bg-transparent dark:bg-transparent",
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
