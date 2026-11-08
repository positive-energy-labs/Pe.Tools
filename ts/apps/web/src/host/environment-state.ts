/** Chrome reads the same mounted seed as its route. No independent fixture maps. */
import { useEffect, useMemo, useState } from "react";
import type { Reading, ReadingRequest } from "@pe/agent-contracts";
import { useRouteSearchSlice } from "../route/activity";
import { fixtureName } from "../shell/fixture-name";
import { useReadingSlice } from "./resource-state";

export function useEnvironmentAccess() {
  const name = useRouteSearchSlice(fixtureName);
  return { key: name, remote: name === null };
}
export function useEnvironmentReading<T>(
  request: ReadingRequest | null,
  slot: string = request?.kind ?? "",
) {
  return useEnvironmentReadingSlice<T, Reading<T>>(request, (reading) => reading, slot);
}
export function useEnvironmentReadingSlice<T, S>(
  request: ReadingRequest | null,
  select: (reading: Reading<T>) => S,
  slot: string = request?.kind ?? "",
) {
  const access = useEnvironmentAccess();
  const live = useReadingSlice<T, S>(access.remote ? request : null, select);
  const name = access.key;
  const identity = useMemo(() => ({ name, slot }), [name, slot]);
  const [saved, setSaved] = useState<{ key: typeof identity; reading: Reading<T> } | null>(null);
  useEffect(() => {
    if (name === null) return;
    let active = true;
    void (async () => {
      const {environmentExample} = await import("../design-system/environment-examples");
      const reading = environmentExample(name, slot);
      if (active) setSaved({key:identity, reading:reading as Reading<T>});
    })().catch((error: unknown) => {
      if (active) setSaved({ key: identity, reading: { state: "failed", message: String(error) } });
    });
    return () => {
      active = false;
    };
  }, [identity, name, slot]);
  return {
    ...access,
    reading: access.remote
      ? live
      : saved?.key === identity
        ? select(saved.reading)
        : select({ state: "absent" }),
  };
}
