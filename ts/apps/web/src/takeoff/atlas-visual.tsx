import { Suspense } from "react";
import type { PlaneViewport } from "@pe/agent-contracts";
import { stageViewport } from "#/scene/stage-controller";
import { Switcher } from "@pe/kit/lang/switcher";
import { LevelPlan } from "#/takeoff/level-plan";
import { LevelTotals } from "#/takeoff/level-totals";
import { ZoneFacts } from "#/takeoff/zone-facts";
import { PictureReadout } from "@pe/kit/lang/readout";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";
import { ScopeKeys } from "@pe/kit/keys";
import { levelsOf } from "#/takeoff/plan";

export function AtlasVisual({ visible, thread }: { visible: boolean; thread?: string }) {
  const {
    store,
    world,
    queriedZones,
    tableState,
    zoneKey,
    cursor,
    level,
    planImage,
    setLevel,
    stateOf,
    zoneCalls,
    selected,
    levelZones,
    selectZone,
    focusRoom,
    scopeShortcuts,
  } = useAtlasWorkspace();
  return (
    <Suspense fallback={<div className="t-small t-upper p-2 text-ink-2">reading plan…</div>}>
      <LevelPlan
        lease={{
          thread,
          visible:
            visible &&
            !!store.displayedCapture &&
            (store.source === "saved" || store.snapshot.state === "ready"),
          page: store.handle.page,
          context: {
            source: store.handle.demo ? "fixture" : store.source,
            captureId: store.displayedCapture?.id,
            capturedAt: store.displayedCapture?.capturedAt,
            observedDocument: store.displayedCapture?.provenance.target,
            work: store.handle.work.key,
            workRevision: store.handle.work.revision,
            stage: store.stage,
            views: store.views,
            zones: store.zones,
            level,
            zone: zoneKey,
            room: cursor,
            filter: tableState.query ?? "",
          },
        }}
        viewport={store.viewport}
        onViewport={stageViewport<PlaneViewport>(({ viewport }, { history }) =>
          store.setViewport(viewport, history),
        )}
        above={
          <>
            <ScopeKeys keys={scopeShortcuts} />
            <div className="flex min-w-0 shrink-0 flex-wrap items-center hairline-b gap-1 px-2 py-1">
              {/* The lanes are a segmented choose-one in the toolbar, not a list. */}
              <Switcher
                ariaLabel="level"
                value={level}
                onChange={setLevel}
                options={levelsOf(world.lanes).map((label) => {
                  const lanes = world.lanes.filter((lane) => lane.label === label);
                  const captured = lanes.filter((lane) => lane.replayPath).length;
                  const zs = world.zones.filter((z) => z.zone.lane.label === label);
                  const calls = zs.reduce((n, z) => n + zoneCalls(z), 0);
                  return {
                    value: label,
                    label: (
                      <>
                        {label}
                        <span className="ml-1">{zs.length}</span>
                        {calls > 0 && (
                          <span className="ml-1" data-tone="alarm">
                            ·{calls}
                          </span>
                        )}
                      </>
                    ),
                    title: `${lanes.length} view${lanes.length === 1 ? "" : "s"} on this level · ${captured} captured this session`,
                  };
                })}
              />
            </div>
          </>
        }
        plan={planImage.image && "plan" in planImage.image ? planImage.image.plan : null}
        planRefusal={
          planImage.image && "refusal" in planImage.image ? planImage.image.refusal : null
        }
        planError={planImage.error}
        planNote={planImage.note}
        zones={levelZones}
        shown={queriedZones}
        stateOf={stateOf}
        rows={store.atlasRows}
        onSelectZone={selectZone}
        onCursor={focusRoom}
        readout={
          <PictureReadout
            title={selected ? `${selected.zone.key} ${selected.name}` : undefined}
            onClear={selected ? () => selectZone(null) : undefined}
          >
            {selected ? (
              <ZoneFacts store={store} zone={selected} stateOf={stateOf} systems={world.systems} />
            ) : (
              <LevelTotals zones={levelZones} stateOf={stateOf} />
            )}
          </PictureReadout>
        }
      />
    </Suspense>
  );
}
