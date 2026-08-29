import type { ComponentProps, ReactNode } from "react";

import { PaneWorkspace } from "#/components/ui/pane";
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
  return (
    <main className={cn("flex h-screen min-h-0 flex-col", className)}>
      {headRail}
      {readoutBand}
      {visual == null ? (
        table
      ) : (
        <PaneWorkspace
          {...pane}
          className={cn("min-h-0 flex-1", pane?.className)}
          navigation={navigation}
          visual={visual}
          content={table}
          inspector={sidePanel}
        />
      )}
    </main>
  );
}
