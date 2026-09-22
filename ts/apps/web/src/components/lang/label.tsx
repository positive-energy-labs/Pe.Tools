import type * as React from "react";

import { tv } from "#/lib/tv";

export const labelRecipe = tv({
  base: "flex items-center gap-2 t-small font-medium select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
});

// ponytail: base-ui has no Label primitive; a native <label> covers every use here.
function Label(props: Omit<React.ComponentProps<"label">, "className">) {
  return <label data-slot="label" className={labelRecipe()} {...props} />;
}

export { Label };
