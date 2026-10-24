import type { ReactNode } from "react";
import "./button.css";
/** A row of controls yields labels before icons and never wraps. */
export function ButtonGroup({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="dl-button-group" role={label ? "group" : undefined} aria-label={label}>
      {children}
    </div>
  );
}
