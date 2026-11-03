import {
  Fragment,
  createElement,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { type AdmittedMount, createRouteShell } from "./admitted-mount";
import type { AdmittedAddressPort } from "./admitted-address";

/** The router's existing history is the only URL owner; writes also notify Back/Forward listeners. */
export function admittedRouterAddress(history: {
  readonly location: { readonly search: string; readonly pathname: string; readonly hash: string };
  push(href: string): void;
  replace(href: string): void;
  subscribe(listener: () => void): () => void;
}): AdmittedAddressPort {
  return {
    read: () => new URLSearchParams(history.location.search),
    write(search, mode) {
      const query = search.toString();
      history[mode](
        `${history.location.pathname}${query ? `?${query}` : ""}${history.location.hash}`,
      );
    },
    subscribe: (listener) => history.subscribe(listener),
  };
}

function Pane({ mount, pane }: { mount: AdmittedMount; pane: string }) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  return createElement(Fragment, null, mount.read(pane) as ReactNode);
}

/** Composition runs after commit, including StrictMode cleanup/remount. No owner publishes in render. */
export function AdmittedPane({
  shell,
  route,
  address,
  pane,
}: {
  shell: ReturnType<typeof createRouteShell>;
  route: AdmittedRoute;
  address: AdmittedAddressPort;
  pane: string;
}) {
  const [mounted, setMounted] = useState<{ route: AdmittedRoute; mount: AdmittedMount } | null>(
    null,
  );
  useEffect(() => {
    const mount = shell.mount(route, address);
    setMounted({ route, mount });
    return mount.close;
  }, [shell, route, address]);
  return mounted?.route === route ? createElement(Pane, { mount: mounted.mount, pane }) : null;
}
