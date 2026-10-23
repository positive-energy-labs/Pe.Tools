import { Suspense } from "react";
import { Button } from "@pe/kit/lang/button";
import { Switcher } from "@pe/kit/lang/switcher";
import { LevelPlan } from "#/takeoff/level-plan";
import { LevelTotals } from "#/takeoff/level-totals";
import { ZoneFacts } from "#/takeoff/zone-facts";
import { PictureReadout } from "#/scene/readout";
import { useAtlasWorkspace } from "#/takeoff/atlas-context";
import { ScopeKeys } from "@pe/kit/keys";
import { levelsOf } from "#/takeoff/plan-image";
import { useRouteSearch } from "#/route/activity";

export function AtlasVisual() {
  const search = useRouteSearch();
  const {
    store,
    world,
    queriedZones,
    tableState,
    zoneKey,
    cursor,
    planOpen,
    level,
    planImage,
    setLevel,
    setPlanOpen,
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
          thread: store.handle.head?.thread ?? search.thread,
          visible:
            planOpen &&
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
        onViewport={(viewport, how) =>
          store.setViewport(viewport, how === "move" ? "push" : "replace")
        }
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

              <span className="hairline-l ml-1 flex items-center gap-1 pl-1">
                <Button
                  kind="framed"
                  label={planOpen ? "▴ hide plan" : "▾ show plan"}
                  onClick={() => setPlanOpen(!planOpen)}
                  reason={
                    planOpen
                      ? "collapse the plan — give the table the full height"
                      : "show the plan"
                  }
                >
                  <span className="face-mono">{planOpen ? "▴ hide plan" : "▾ show plan"}</span>
                </Button>
              </span>
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
        selectedKey={zoneKey}
        cursor={cursor}
        stateOf={stateOf}
        onSelectZone={selectZone}
        onHover={(id) => store.actions.hover(id)}
        onCursor={focusRoom}
        readout={
          <PictureReadout
            hug
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
