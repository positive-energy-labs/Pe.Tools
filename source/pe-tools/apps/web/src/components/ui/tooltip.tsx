import type { ReactNode } from "react";
import { Tooltip } from "@base-ui/react/tooltip";

export function UiTooltipProvider({ children }: { children: ReactNode }) {
  return <Tooltip.Provider delay={150}>{children}</Tooltip.Provider>;
}

export { Tooltip };
