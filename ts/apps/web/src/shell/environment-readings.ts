/** Chrome reads the same mounted seed as its route. No independent fixture maps. */
import { useEffect, useMemo, useState } from "react";
import type { Reading, ReadingRequest } from "@pe/agent-contracts";
import { useRouteSearchSlice } from "../route/activity";
import { fixtureName } from "./fixture-lane";
import { createFixtureMount } from "./fixture";
import { useReadingSlice } from "./readings-hooks";

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
    let close = () => {};
    void (async () => {
      if (slot !== "machine") {
        const { createChatFixture } = await import("../chat/admission");
        const { chatReading } = await import("../chat/graph");
        const owner = await createChatFixture(name);
        if (!active) return owner.dispose();
        const publish = () => {
          if (active) setSaved({ key: identity, reading: chatReading<T>(owner, slot) });
        };
        const release = owner.subscribe(publish);
        close = () => {
          release();
          owner.dispose();
        };
        publish();
        return;
      }
      const owner = await createFixtureMount((await import("../open/graph")).openGraph, name);
      if (!active) {
        owner.dispose();
        return;
      }
      close = () => owner.dispose();
      const publish = () => {
        if (!active) return;
        const state = owner.readings.get(slot);
        const failure = owner.snapshot().failure ?? state.error;
        const reading: Reading<T> = failure
          ? { state: "failed", message: failure }
          : state.status === "ready"
            ? { state: "ready", observation: state.value as T }
            : { state: "absent" };
        setSaved({ key: identity, reading });
      };
      const disconnect = owner.connect();
      const un = owner.readings.subscribe(slot, publish);
      const release = owner.readings.mount([slot]);
      close = () => {
        release();
        un();
        disconnect();
        owner.dispose();
      };
      publish();
    })().catch((error: unknown) => {
      if (active) setSaved({ key: identity, reading: { state: "failed", message: String(error) } });
    });
    return () => {
      active = false;
      close();
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
