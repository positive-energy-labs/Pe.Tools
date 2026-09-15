/**
 * The Takeoffs route mount. Target resolution, the owner, the readings and the actions are all
 * `useRoute(manifest)`; this file chooses live versus saved and binds standalone room navigation
 * to the URL. The workbench owner omits that binding and gets controller-mount navigation.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { TakeoffCapture } from "@pe/agent-contracts";

import { SavedTakeoffsRoute } from "#/takeoff/saved-review";
import { useTakeoffsController, type TakeoffNavigation } from "#/takeoff/controller";
import { TakeoffsPage } from "#/takeoff/route-workspace";

export function TakeoffsRoute({
  target = "",
  work,
  level = "",
  zone,
  room,
}: {
  target?: string;
  work?: string;
  level?: string;
  zone?: string;
  room?: string;
}) {
  // `?work=<capture>` names a saved capture; otherwise the route binds the live target.
  if (work) return <SavedTakeoffsRoute capture={work} />;
  return <LiveTakeoffsRoute target={target} level={level} zone={zone} room={room} />;
}

export function LiveTakeoffsRoute({
  target = "",
  level = "",
  zone,
  room,
}: {
  target?: string;
  level?: string;
  zone?: string;
  room?: string;
}) {
  // Render mechanics only: wait for the client URL before mounting its route owner.
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate({ from: "/takeoffs" });
  const navigation = useMemo(
    () => ({
      value: { level, zone: zone ?? null, room: room ?? null },
      set: (patch: Partial<TakeoffNavigation>) =>
        void navigate({
          search: (previous) => ({
            ...previous,
            ...(patch.level === undefined ? {} : { level: patch.level || undefined }),
            ...(patch.zone === undefined ? {} : { zone: patch.zone ?? undefined }),
            ...(patch.room === undefined ? {} : { room: patch.room ?? undefined }),
          }),
        }),
    }),
    [level, navigate, room, zone],
  );
  useEffect(() => setMounted(true), []);
  return mounted ? <TakeoffsControllerOwner target={target} navigation={navigation} /> : null;
}

export function TakeoffsControllerOwner({
  target = "",
  savedCapture,
  navigation,
}: {
  target?: string;
  savedCapture?: TakeoffCapture;
  navigation?: Parameters<typeof useTakeoffsController>[0]["navigation"];
}) {
  const store = useTakeoffsController({
    target,
    ...(savedCapture ? { savedCapture } : {}),
    ...(navigation ? { navigation } : {}),
  });
  return <TakeoffsPage store={store} />;
}
