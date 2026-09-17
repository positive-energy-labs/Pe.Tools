import { useEffect, useMemo } from "react";

import type { EntityPage } from "#/route";
import { EntityRouteView } from "#/route/entity";
import { usePodList } from "#/route/pods";
import { familyFixtures, type AuthoredFamilyName } from "#/family/authored-families";
import { useFamilyStore } from "#/family/store";
import { FamilyWorkspace, familyFacts } from "#/family/workspace";
import { familySpec } from "./manifest";

/** The demo lane holds no family model schema offline, so its editor opens the raw JSON. */
const DEMO_SCHEMA = "";

/** `/family`: the kernel's entity route around the family audit. */
export function FamilyRouteView({
  target = null,
  thread,
  capture,
  initial,
}: {
  target?: string | null;
  thread?: string;
  /** `?capture=true`: capture the open family as soon as the route can. */
  capture?: boolean;
  initial?: Partial<EntityPage>;
}) {
  const demo = useMemo(() => new URLSearchParams(globalThis.location?.search).has("demo"), []);
  const [pods, refreshPods] = usePodList(!demo);
  const store = useFamilyStore({ target, thread, pods, initial });
  const captureReady = store.handle.actions.capture.refusal === null;
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
          ? { content: familyFixtures[name], schema: DEMO_SCHEMA }
          : undefined
      }
      facts={familyFacts(store)}
    >
      <FamilyWorkspace store={store} />
    </EntityRouteView>
  );
}
