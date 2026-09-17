import type { ComponentProps, ReactNode } from "react";

import { PaneWorkspace } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
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
  // Targeting scrolls away after page open while the workspace stays in the viewport. `Surface`
  // owns that scroll boundary and the common gutter; panes own their body scrolling.
  return (
    <div className={cn("h-full", className)}>
      <Surface head={headRail}>
        <>
          {readoutBand != null && (
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
        </>
      </Surface>
    </div>
  );
}
