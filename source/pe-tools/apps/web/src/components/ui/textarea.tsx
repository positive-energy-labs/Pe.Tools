import * as React from "react";

import { cn } from "#/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-line bg-line/20 px-2 py-2 text-sm transition-colors outline-none placeholder:text-ink-2 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-caution aria-invalid:ring-2 aria-invalid:ring-caution/20 md:t-value dark:bg-line/30 dark:aria-invalid:border-caution/50 dark:aria-invalid:ring-caution/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
