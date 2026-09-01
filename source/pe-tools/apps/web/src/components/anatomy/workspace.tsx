import type { ComponentProps, ReactNode } from "react";

import { PaneWorkspace } from "#/components/lang/pane";
import { cn } from "#/lib/utils";

export interface WorkspaceProps {
  headRail?: ReactNode;
  table: ReactNode;
  sidePanel?: ReactNode;
  readoutBand?: ReactNode;
  navigation?: ReactNode;
  visual?: ReactNode;
  pane?: Omit<
    ComponentProps<typeof PaneWorkspace>,
    "navigation" | "visual" | "content" | "inspector"
  >;
  className?: string;
}

export function Workspace({
  headRail,
  table,
  sidePanel,
  readoutBand,
  navigation,
  visual,
  pane,
  className,
}: WorkspaceProps) {
  // Targeting is needed on page open and when a problem occurs, not while working: the head rail
  // sits in outer scroll flow while the work area is a sticky full-viewport block, so one wheel
  // notch retires the rail and the workspace pins (takeoffs annotations, 2026-08-31). Inner
  // scrollers chain back up to reveal it again.
  return (
    <main className={cn("no-scrollbar h-screen overflow-y-auto", className)}>
      {headRail}
      <div className="sticky top-0 flex h-screen min-h-0 flex-col">
        {readoutBand != null && (
          // The band is a READOUT under the rail, not a strip glued to it: the container owns the
          // inset so every chip and outcome line in it breathes the same (annotation, 2026-08-31).
          <div data-slot="readout-band" className="shrink-0 px-2 py-1.5">
            {readoutBand}
          </div>
        )}
        {visual == null ? (
          table
        ) : (
          <PaneWorkspace
            {...pane}
            grow
            navigation={navigation}
            visual={visual}
            content={table}
            inspector={sidePanel}
          />
        )}
      </div>
    </main>
  );
}
