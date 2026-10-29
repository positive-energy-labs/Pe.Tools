import type { ReactNode } from "react";
import { commandTool, type RouteGraphJson } from "@pe/agent-contracts";

/** The discoverable projection of a route's full, typed manifest. */
interface RegisteredManifest {
  readonly key: string;
  readonly name: string;
  readonly work?: { readonly title: string };
  readonly graph?: RouteGraphJson;
}
type HostedRouteView = (props: { thread: string; visible: boolean }) => ReactNode;
export interface RouteRegistration {
  readonly manifest: RegisteredManifest;
  readonly hosted: HostedRouteView;
}

/** One registration owns discovery, action attribution and the actual hosted surface. */
export function createRouteRegistry() {
  const routes = new Map<string, RouteRegistration>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };

  return {
    /** Built-in and Pod routes take this one path; the answer removes exactly this registration. */
    register(registration: RouteRegistration) {
      const key = registration.manifest.key;
      if (!key.trim()) throw Error("a route registration needs its manifest key");
      if (routes.has(key)) throw Error(`route ${key} is already registered`);
      routes.set(key, registration);
      changed();
      return () => {
        if (routes.get(key) !== registration) return;
        routes.delete(key);
        changed();
      };
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    revision: () => revision,
    keys: () => [...routes.keys()],
    entries: () => [...routes.values()],
    get: (key: string) => routes.get(key),
    actionRoute(key: string): string | null {
      const tool = commandTool(key);
      return tool && routes.has(tool.name) ? tool.name : null;
    },
  };
}
