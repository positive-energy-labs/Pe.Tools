import { useEffect, useMemo } from "react";

import { frozenDemo } from "#/host/demo-client";
import type { EntityPage } from "#/route";
import { EntityRouteView } from "#/route/entity";
import { BuildStrip } from "#/family/build";
import { usePodList } from "#/route/pods";
import { familyFixtures, type AuthoredFamilyName } from "#/family/authored-families";
import { useFamilyStore } from "#/family/store";
import { FamilyWorkspace, familyFacts } from "#/family/workspace";
import { familyDemoFields, familySpec } from "./manifest";
import { FAMILY_STAGES } from "./stage";

/** The demo lane holds no family model schema offline, so its editor opens the raw JSON. */
const DEMO_SCHEMA = "";

/** `/family`: the kernel's entity route around the family audit. */
export function FamilyRouteView({
  target = null,
  thread,
  capture,
  initial,
  url = true,
}: {
  target?: string | null;
  thread?: string;
  /** `?capture=true`: capture the open family as soon as the route can. */
  capture?: boolean;
  initial?: Partial<EntityPage>;
  /** False in a chat pane, which does not own the URL. */
  url?: boolean;
}) {
  const demo = useMemo(() => frozenDemo() !== null, []);
  const [pods, refreshPods] = usePodList(!demo);
  const store = useFamilyStore({ target, thread, pods, initial });
  const captureReady = store.handle.actions.capture.refusal === null;
  const readReady = store.handle.actions.read.refusal === null;
  // Unread once the Work reading is current: a reload must not read over a draft still loading.
  const unread = store.snapshot === null && store.handle.work.current;
  useEffect(() => {
    // The audit is the live family: an empty draft reads it on arrival, no pod needed. The
    // `family` Reading stream only observes captures, so this hidden read is its acquisition
    // until the stream acquires on subscribe (owed: host contract).
    if (unread && readReady) void store.actions.read().catch(() => undefined);
  }, [unread, readReady]); // eslint-disable-line react-hooks/exhaustive-deps
  // The build review is build's sheet (ruling 45), in the right pane as the plan is apply's.
  const review = store.armedBuild ? (
    <BuildStrip
      armed={store.armedBuild}
      building={store.handle.busy?.key === "build"}
      said={store.buildOutcome}
      refusal={store.handle.actions.build.refusal}
      facts={store.buildFacts}
      familyName={store.lane.world.familyName}
      count={store.lane.world.paramRows.length}
      onReasonChange={store.actions.setBuildReason}
      onCommit={() => void store.actions.build().catch(() => undefined)}
      onCancel={store.actions.cancelBuild}
      onReplan={store.actions.armBuild}
    />
  ) : null;
  useEffect(() => {
    if (capture && captureReady) void store.actions.capture().catch(() => undefined);
    // Once per arrival: the flag names an intent, not a standing order.
  }, [capture, captureReady]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = store.member?.path
    .split("/")
    .at(-1)
    ?.replace(/\.json$/, "") as AuthoredFamilyName;
  return (
    <EntityRouteView
      def={familySpec}
      handle={store.handle as never}
      refreshPods={refreshPods}
      fixture={
        demo && familyFixtures[name]
          ? {
              content: familyFixtures[name],
              schema: DEMO_SCHEMA,
              fields: familyDemoFields(familyFixtures[name]),
            }
          : undefined
      }
      facts={familyFacts(store)}
      url={url}
      stages={FAMILY_STAGES}
      pick={(member) => void store.actions.open(member).catch(() => undefined)}
      review={review ? { title: "build", body: review } : null}
    >
      <FamilyWorkspace store={store} />
    </EntityRouteView>
  );
}
