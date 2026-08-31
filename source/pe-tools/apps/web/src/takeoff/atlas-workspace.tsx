import { Workspace } from "#/components/anatomy";
import { OutcomeLine } from "#/components/lang/outcome";
import { AtlasNavigation } from "#/takeoff/atlas-navigation";
import { AtlasTable } from "#/takeoff/atlas-table";
import { AtlasVisual } from "#/takeoff/atlas-visual";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";

const PLAN_MIN_PX = 140;
const PLAN_MAX_PX = 720;
const PLAN_DEFAULT_PX = 320;
const PLAN_CHROME_PX = 34;

export function AtlasWorkspace() {
  const { geoReady, headRail, sidePanel, readoutBand, planOpen, setPlanOpen } = useAtlasWorkspace();
  return (
    <Workspace
      className="[&_[data-slot=pane-header]_h2]:text-ink [&_[data-kind=visual]_[data-slot=pane-header]]:bg-recess [&_[data-kind=content]_[data-slot=pane-header]]:border-t-2 [&_[data-kind=content]_[data-slot=pane-header]]:border-t-line-2 [&_[data-kind=content]_[data-slot=pane-header]]:bg-recess"
      headRail={headRail}
      readoutBand={
        readoutBand ??
        (!geoReady ? (
          <div className="px-2 py-1">
            <OutcomeLine
              kind="busy"
              label="loading room geometry"
              says="rooms draw as position dots until their boundaries land"
            />
          </div>
        ) : null)
      }
      navigation={<AtlasNavigation />}
      visual={<AtlasVisual />}
      table={<AtlasTable />}
      sidePanel={sidePanel}
      pane={{
        resize: {
          visual: {
            defaultSize: PLAN_DEFAULT_PX + PLAN_CHROME_PX,
            minSize: PLAN_MIN_PX + PLAN_CHROME_PX,
            maxSize: PLAN_MAX_PX + PLAN_CHROME_PX,
            minOtherSize: 220,
            persist: "pe.takeoffs.plan-height",
            collapse: {
              collapsed: !planOpen,
              onCollapsedChange: (collapsed) => setPlanOpen(!collapsed),
              collapsedSize: PLAN_CHROME_PX,
              collapseBelow: PLAN_MIN_PX + 6,
            },
          },
        },
      }}
    />
  );
}
