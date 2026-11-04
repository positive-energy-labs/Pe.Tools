import { createWorkScopeAcceptance } from "./work-scope-acceptance";
import { canonicalRouteInput } from "@pe/agent-contracts";
import { type MountAdapters } from "./mount-contracts";
/** Owns Target/Work identity, external snapshots and mount publication lifetime. */
export function createMountTarget<W>(adapters: Pick<MountAdapters<unknown, W>, "getSnapshot">) {
  let raw = adapters.getSnapshot();
  const acceptance = createWorkScopeAcceptance(() => ({
    target: raw.target,
    work: raw.workKey ?? raw.work?.handle.key ?? null,
  }));
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
    get raw() {
      return raw;
    },
    acceptance,
    get disposed() {
      return disposed;
    },
    get connected() {
      return connected;
    },
    set connected(value: boolean) {
      connected = value;
    },
    available: () => available(),
    setAvailable(this: void, check: () => boolean) {
      available = check;
    },
    notify,
    listeners,
    version: () => serial,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update() {
      const previousTarget = raw.target;
      raw = adapters.getSnapshot();
      acceptance.capture();
      return (
        previousTarget.kind !== "host" &&
        canonicalRouteInput(previousTarget) !== canonicalRouteInput(raw.target)
      );
    },
    close() {
      acceptance.close();
      disposed = true;
      connected = false;
    },
    dispose() {
      listeners.clear();
    },
  };
}
export type MountTarget<W> = ReturnType<typeof createMountTarget<W>>;
