import { type ReactNode } from "react";
import { RegistryContext } from "@effect/atom-react";
import { type TakeoffsRouteDocument, type takeoffCaptureSummarySchema } from "@pe/agent-contracts";
import type { z } from "zod";
import { GraphHistory, routeFromGraph, type RouteAdapters, type MountBody } from "#/shell/mount";
import { NativeObservationScope } from "#/revit/observation";
import { Ladder } from "#/route/ladder";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { Code } from "@pe/kit/lang/code";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { takeoffGraph, type TakeoffGraphPage } from "./graph";
import { takeoffBinding, takeoffRefusal, valueOf } from "./graph-actions";
import { takeoffSources } from "./sources";
import { useTakeoffStore, type TakeoffMount } from "./store";
import { useAtlasModel } from "./atlas";
import { AtlasProvider, useAtlasWorkspace } from "./atlas-context";
import { AtlasNavigation } from "./atlas-navigation";
import { AtlasVisual } from "./atlas-visual";
import { AtlasTable, AtlasRoomPanel } from "./atlas-table";
import { TakeoffAttention } from "./attention";
import { AdoptRegions } from "./adopt-panel";
import { PartitionReview } from "./partition-review";
import { TakeoffKernel } from "./kernel-context";
import { takeoffReadingHealth } from "./actions";
import type { planOf } from "./plan";

type Body = MountBody<TakeoffGraphPage, TakeoffsRouteDocument>;
function Provider({ owner, children }: { owner: TakeoffMount; children: ReactNode }) {
  const store = useTakeoffStore(owner);
  const plan = valueOf<{ image: ReturnType<typeof planOf> | null; note: string | null }>(
    store.scope,
    "plan",
  );
  const model = useAtlasModel(
    { store },
    {
      image: plan?.image ?? null,
      note: plan?.note ?? null,
      error: store.scope.readings.plan?.error ?? store.scope.readings.ownerCrops?.error ?? null,
    },
  );
  return (
    <RegistryContext value={owner.registry}>
      <TakeoffKernel value={owner}>
        <TakeoffAttention store={store}>
          <NativeObservationScope value={store.nativeObservation}>
            <AtlasProvider value={model}>{children}</AtlasProvider>
          </NativeObservationScope>
        </TakeoffAttention>
      </TakeoffKernel>
    </RegistryContext>
  );
}
function ScopeBody({ owner, page }: Body) {
  const { store } = useAtlasWorkspace();
  const many = (owner.readings.get("captures").value ?? []) as z.infer<
    typeof takeoffCaptureSummarySchema
  >[];
  const toggle = (values: readonly string[], id: string) =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
  const health = takeoffReadingHealth(store.snapshot);
  return (
    <>
      {health && <OutcomeLine kind="advisory" label="Takeoff reading" says={health} />}
      {store.snapshot.state === "failed" && store.snapshot.previous && (
        <OutcomeLine
          kind="error"
          label="geometry refresh failed — showing last successful read"
          says={store.snapshot.message}
        />
      )}
      {page.work ? (
        <>
          <p>
            Archived takeoff · {store.savedCapture?.capturedAt ?? "Reading saved capture…"} ·{" "}
            {store.savedCapture?.provenance.target.session} /{" "}
            {store.savedCapture?.provenance.target.openId}
          </p>
          {owner.readings.get("saved").error && (
            <p role="alert">{owner.readings.get("saved").error}</p>
          )}
          <Button label="live" onClick={() => owner.view.setPage({ work: "" })}>
            live
          </Button>
        </>
      ) : (
        <>
          <Ladder
            levels={[
              {
                key: "views",
                label: store.views.length ? `${store.views.length} views` : null,
                placeholder: "choose views",
                options: store.world.lanes.map((lane) => ({ id: lane.view, label: lane.view })),
                multi: true,
                picked: (id) => store.views.includes(id),
                pick: (id) => store.actions.chooseViews(toggle(store.views, id)),
              },
            ]}
          />
          {page.stage !== "adopt" && (
            <Ladder
              levels={[
                {
                  key: "zones",
                  label: store.zones.length ? `${store.zones.length} zones` : null,
                  placeholder: "choose zones",
                  options: store.world.zones
                    .filter((zone) => store.views.includes(zone.zone.lane.view))
                    .map((zone) => ({
                      id: zone.zone.guid,
                      label: zone.name,
                      sub: `${zone.rooms.length} rooms`,
                    })),
                  multi: true,
                  picked: (id) => store.zones.includes(id),
                  pick: (id) => store.actions.chooseZones(toggle(store.zones, id)),
                },
              ]}
            />
          )}
          {page.stage === "sync" && (
            <Input
              aria-label="RHVAC file path"
              value={page.r10}
              onChange={(event) => store.actions.chooseR10(event.target.value)}
            />
          )}
        </>
      )}
      <Ladder
        levels={[
          {
            key: "capture",
            label: many.find((row) => row.id === page.work)?.title || null,
            placeholder: "saved captures",
            options: many.map((row) => ({
              id: row.id,
              label: row.title || row.id,
              sub: row.capturedAt,
            })),
            picked: (id) => id === page.work,
            pick: (work) => owner.view.setPage({ work }),
          },
        ]}
      />
    </>
  );
}
function ReviewBody({ owner, page, verbs }: Body) {
  const { store } = useAtlasWorkspace();
  const review = store.review;
  const text = owner.readings.get("text");
  const raw = text.value as { path: string; text: string } | undefined;
  return (
    <>
      {review && (
        <PartitionReview
          review={review}
          onFlag={store.readOnly ? undefined : (key) => store.actions.flagReview(key)}
        />
      )}
      {!store.readOnly &&
        Object.entries(store.cells).flatMap(([segment, cells]) =>
          Object.entries(cells).map(([key]) => (
            <div key={`${segment}:${key}`} role="group" aria-label={`Cell ${segment} ${key}`}>
              <span>
                {segment} · {key}
              </span>
              {verbs({ segment, key })}
            </div>
          )),
        )}
      <GraphHistory owner={owner} receipts="receipts" />
      {page.work && (
        <details onToggle={(event) => owner.view.setPage({ fileText: event.currentTarget.open })}>
          <summary>Saved capture · file text as stored</summary>
          {text.error ? (
            <p role="alert">{text.error}</p>
          ) : raw ? (
            <>
              <p>{raw.path}</p>
              <Code code={raw.text} lang="json" title="file text" />
            </>
          ) : (
            <p>Reading file text…</p>
          )}
        </details>
      )}
    </>
  );
}
function AdoptionBody() {
  const { store } = useAtlasWorkspace();
  return store.readOnly ? null : <AdoptRegions store={store} />;
}
function NavigationBody({ page, verbs }: Body) {
  return (
    <>
      <AtlasNavigation />
      {page.zone && verbs({ zone: page.zone })}
    </>
  );
}
export const takeoffAdapters: RouteAdapters<TakeoffGraphPage, TakeoffsRouteDocument> = {
  sources: takeoffSources(),
  binding: takeoffBinding,
  cell: (raw, scope) => {
    const row = raw as { segment?: string; key?: string } | null;
    if (
      !row?.key ||
      !row.segment ||
      !["edits", "adopt", "decisions", "reviewFlags"].includes(row.segment) ||
      takeoffRefusal(scope) ||
      !scope.work
    )
      return null;
    return {
      type: `cell:${row.segment}`,
      id: row.key,
      path: [row.segment, row.key],
      work: scope.work.handle.key,
    };
  },
  verbDepends: {
    initialize: ["snapshot"],
    adopt: ["snapshot", "candidates"],
    partition: ["snapshot"],
    room: ["snapshot"],
    decide: ["snapshot"],
    sync: ["snapshot", "rhvacVersion"],
  },
  verbReadings: { refresh: ["snapshot"], "retry-r10": ["rhvacVersion"] },
  receiptPaths: (receipt) =>
    receipt.key === "takeoffs.sync" ? [["edits"], ["bases"], ["decisions"]] : [],
  wrap: (owner, children) => <Provider owner={owner}>{children}</Provider>,
  bodies: {
    scope: (body) => <ScopeBody {...body} />,
    adoption: () => <AdoptionBody />,
    navigation: (body) => <NavigationBody {...body} />,
    plan: ({ visible, thread }) => <AtlasVisual visible={visible} thread={thread} />,
    rooms: () => <AtlasTable />,
    room: () => <AtlasRoomPanel />,
    review: (body) => <ReviewBody {...body} />,
  },
};
export const takeoffsRoute = routeFromGraph(takeoffGraph, takeoffAdapters, "/takeoffs");
