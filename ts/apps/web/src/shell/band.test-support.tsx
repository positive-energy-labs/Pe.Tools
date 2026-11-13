import { useState, type ReactNode } from "react";
import { DockBand } from "./pane-actions";

/** Standalone route journeys supply the same band outlet as a docked route. */
export function StandaloneBand({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  return <DockBand value={{ node }}><div ref={setNode} />{children}</DockBand>;
}
