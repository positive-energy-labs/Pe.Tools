import { canonicalRouteInput, workKey } from "@pe/agent-contracts";
import { type MountAdapters } from "./mount-contracts";
/** Owns Target/Work identity, external snapshots and mount publication lifetime. */
export function createMountTarget<W>(adapters: Pick<MountAdapters<unknown,W>, "getSnapshot">) {
  let raw = adapters.getSnapshot();
  // One count per Target/Work-key change: a verb's result is admitted only into the generation it started in.
  let generation = 0;
  let scopeId = canonicalRouteInput([
    raw.target,
    raw.workKey ? workKey(raw.workKey) : raw.work ? workKey(raw.work.handle.key) : null,
  ]);
  let disposed = false;
  let available = () => true;
  let serial = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    if (!disposed) {
      serial++;
      for (const listener of listeners) listener();
    }
  };
  let connected = false;
  return {
    get raw() { return raw; }, get generation() { return generation; },
    get disposed() { return disposed; }, get connected() { return connected; },
    set connected(value: boolean) { connected = value; },
    available: () => available(), setAvailable(this: void, check: () => boolean) { available = check; },
    notify, listeners, version: () => serial,
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update() {
      const previousTarget = raw.target;
      raw = adapters.getSnapshot();
      const id = canonicalRouteInput([raw.target, raw.workKey ? workKey(raw.workKey) : raw.work ? workKey(raw.work.handle.key) : null]);
      if (id !== scopeId) { scopeId = id; generation++; }
      return previousTarget.kind !== "host" && canonicalRouteInput(previousTarget) !== canonicalRouteInput(raw.target);
    },
    close() { disposed = true; connected = false; },
    dispose() { listeners.clear(); },
  };
}
export type MountTarget<W> = ReturnType<typeof createMountTarget<W>>;

