import { createAdmittedRouteRegistry } from "../../../../packages/agent-contracts/src/route-module";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";

const registry = createAdmittedRouteRegistry();
const routes = new Map<string, AdmittedRoute>();
const listeners = new Set<() => void>();
let revision = 0;
const publish = () => {
  revision++;
  for (const notify of listeners) notify();
};
/** Only authenticated handles enter dynamic Pod discovery. React unmounts withdrawn handles. */
export const podRoutes = {
  subscribe: (notify: () => void) => {
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  },
  revision: () => revision,
  get: (key: string) => {
    const route = routes.get(key);
    return route ? registry.resolve(route) : null;
  },
  entries: () => [...routes.entries()],
  register(key: string, route: AdmittedRoute) {
    if (routes.has(key)) throw Error("Pod already registered");
    const receipt = registry.register(route);
    routes.set(key, route);
    publish();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      routes.delete(key);
      receipt.deactivate();
      publish();
    };
  },
};
