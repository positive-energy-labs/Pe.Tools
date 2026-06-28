import { createContext, useContext } from "react";
import type * as React from "react";

import { cn } from "#/lib/utils";

// ponytail: a segmented "pick one" control. base-ui's ToggleGroup is array/multi-select; a
// single-value pill row is two elements of plain JSX, so it stays here instead of pulling that in.
const ToggleGroupContext = createContext<{
  value: string;
  onValueChange: (value: string) => void;
} | null>(null);

function ToggleGroup({
  value,
  onValueChange,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <ToggleGroupContext.Provider value={{ value, onValueChange }}>
      <div
        role="group"
        data-slot="toggle-group"
        className={cn(
          "inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </ToggleGroupContext.Provider>
  );
}

function ToggleGroupItem({
  value,
  className,
  ...props
}: React.ComponentProps<"button"> & { value: string }) {
  const ctx = useContext(ToggleGroupContext);
  const active = ctx?.value === value;
  return (
    <button
      type="button"
      data-slot="toggle-group-item"
      aria-pressed={active}
      onClick={() => ctx?.onValueChange(value)}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
