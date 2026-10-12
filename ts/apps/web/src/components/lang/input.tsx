import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { tv } from "#/lib/tv";

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
}: Omit<React.ComponentProps<"input">, "className"> &
  import("#/lib/tv").VariantProps<typeof inputRecipe> & { face?: "mono" }) {
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
