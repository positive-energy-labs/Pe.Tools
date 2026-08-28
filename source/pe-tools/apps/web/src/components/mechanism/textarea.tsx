import * as React from "react";

import { cn } from "#/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-md border border-line bg-line/20 px-2 py-2 text-sm transition-colors duration-(--motion) outline-none placeholder:text-ink-2 focus-visible:border-line-2 focus-visible:ring-2 focus-visible:ring-line-2/30 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-alarm aria-invalid:ring-2 aria-invalid:ring-alarm/20 md:text-xs/relaxed dark:bg-line/30 dark:aria-invalid:border-alarm/50 dark:aria-invalid:ring-alarm/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
