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
    <main className={cn("h-screen overflow-y-auto", className)}>
      {headRail}
      <div className="sticky top-0 flex h-screen min-h-0 flex-col">
        {readoutBand}
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
