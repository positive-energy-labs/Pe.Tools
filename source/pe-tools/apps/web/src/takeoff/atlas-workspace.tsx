import { PaneSplit } from "#/components/lang/pane";
import { OutcomeLine } from "#/components/lang/outcome";
import { Surface } from "#/components/lang/surface";
import { AtlasNavigation } from "#/takeoff/atlas-navigation";
import { AtlasTable } from "#/takeoff/atlas-table";
import { AtlasVisual } from "#/takeoff/atlas-visual";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";

const PLAN_MIN_PX = 140;
const PLAN_MAX_PX = 720;
const PLAN_DEFAULT_PX = 320;
const PLAN_CHROME_PX = 34;

export function AtlasWorkspace() {
  const { geometry, headRail, sidePanel, readoutBand, planOpen, setPlanOpen } = useAtlasWorkspace();
  const readout =
    geometry?.state === "failed" ? (
      <>
        {readoutBand}
        <OutcomeLine
          kind="error"
          label={
            geometry.previous !== undefined
              ? "geometry refresh failed — showing last successful read"
              : "room geometry unavailable"
          }
          says={geometry.message}
        />
      </>
    ) : (
      (readoutBand ??
      (geometry === undefined || geometry.state === "loading" ? (
        <OutcomeLine
          kind="busy"
          label="loading room geometry"
          says="rooms draw as position dots until their boundaries land"
        />
      ) : geometry.state === "absent" ? (
        <OutcomeLine
          kind="advisory"
          label="no room geometry bound"
          says="select a document and refresh its geometry"
        />
      ) : null))
    );
  return (
    <Surface head={headRail}>
      {readout != null && (
        <div data-slot="readout-band" className="shrink-0 py-1.5">
          {readout}
        </div>
      )}
      <PaneSplit
        axis="horizontal"
        grow
        resize={{ target: "start", defaultSize: 288, minSize: 200 }}
        start={<AtlasNavigation />}
        end={
          <PaneSplit
            axis="vertical"
            grow
            resize={{
              target: "start",
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
            }}
            start={
              <PaneSplit
                axis="horizontal"
                grow
                resize={{ target: "end", defaultSize: 320, minSize: 240 }}
                start={<AtlasVisual />}
                end={sidePanel}
              />
            }
            end={<AtlasTable />}
          />
        }
      />
    </Surface>
  );
}
