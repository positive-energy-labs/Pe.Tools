import { mountTypedRoute, type TypedMount } from "#/shell/typed-mount";
import { currentFixture } from "../shell/fixture-name";
import { routeRegistry } from "#/route/registry";
import { module, type OpenContext } from "./route";
import { useOpenTypedOwner } from "./typed-owner";
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
    const mounted = mountTypedRoute(module, {
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
  return mount.draw("documents", ctx => <ControlOwner ctx={ctx}>{children}</ControlOwner>) as ReactNode;
}
function ControlOwner({ ctx, children }: { ctx: OpenContext; children: ReactNode }) {
  const owner = useOpenTypedOwner(ctx);
  return <OpenOwnerContext value={owner}>{children}</OpenOwnerContext>;
}
