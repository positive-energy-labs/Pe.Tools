import { mountTypedRoute, type TypedMount } from "../shell/typed-mount";
import { currentFixture } from "../shell/fixture-name";
import { routeRegistry } from "../route/registry";
import { useOpenTypedOwner, type OpenSource } from "./typed-owner";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { OpenOwnerContext } from "./context";
export {
  OpenOwnerContext,
  OpenControlScope,
  useOpenKernel,
  useOpenOwner,
  outcomeOf,
} from "./context";
/** Companion controls use the same typed actions as the Open route, with private Page pose. */
export function OpenControls({ children }: { children: ReactNode }) {
  const [mount, setMount] = useState<TypedMount | null>(null);
  useEffect(() => {
    let active = true;
    const listeners = new Set<() => void>();
    let search = new URLSearchParams();
    const mounted = mountTypedRoute(routeRegistry.open!.module, {
      address: { read: () => new URLSearchParams(search), write: value => { search = new URLSearchParams(value); listeners.forEach(f => f()); },
        subscribe: listener => { listeners.add(listener); return () => void listeners.delete(listener); } },
      fixture: currentFixture(), target: { kind: "host" }, work: { address: null, open: null },
      custody: { current: () => active }, memory: () => ({}),
    }, routeRegistry.open!.fingerprint);
    setMount(mounted);
    return () => { active = false; mounted.dispose(); };
  }, []);
  return mount ? <Controls mount={mount}>{children}</Controls> : null;
}
function Controls({ mount, children }: { mount: TypedMount; children: ReactNode }) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  // The companion controls draw no pane: they read the mount, so the app's children stay drawn while the
  // machine reading is value-less (a pane's `draw` would hand them the shell's one line instead).
  return <ControlOwner ctx={{ value: mount.value(), write: mount.action, page: mount.page } as unknown as OpenSource}>{children}</ControlOwner>;
}
function ControlOwner({ ctx, children }: { ctx: OpenSource; children: ReactNode }) {
  const owner = useOpenTypedOwner(ctx);
  return <OpenOwnerContext value={owner}>{children}</OpenOwnerContext>;
}
