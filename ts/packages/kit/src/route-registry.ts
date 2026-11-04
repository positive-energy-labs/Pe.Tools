import type { ReactNode } from "react";
import { commandTool } from "@pe/agent-contracts";
import type { AdmittedRoute } from "../../agent-contracts/src/route-kernel-admission.ts";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../agent-contracts/src/route-module.ts";

export type HostedRouteView = (props: {
  thread: string;
  visible: boolean;
  target?: string;
  work?: string;
}) => ReactNode;

/** Kernel discovery and mounting authenticate the same exact A-issued handle. */
export function createRouteRegistry() {
  const admissions = createAdmittedRouteRegistry();
  const routes = new Map<
    string,
    { readonly route: AdmittedRoute; readonly hosted: HostedRouteView }
  >();
  const listeners = new Set<() => void>();
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of listeners) listener();
  };
  return {
    register(route: AdmittedRoute, hosted: HostedRouteView) {
      const key = route.data.key;
      if (routes.has(key)) throw Error(`route ${key} is already registered`);
      // Authenticate before publishing or notifying. No namespace has an exemption.
      const receipt = admissions.register(route);
      const registration = Object.freeze({ route, hosted });
      routes.set(key, registration);
      changed();
      return () => {
        if (routes.get(key) !== registration) return;
        receipt.deactivate();
        routes.delete(key);
        changed();
      };
    },
    /** Called immediately before mount/dispatch; retired and copied handles refuse. */
    resolve(candidate: unknown) {
      const route = admissions.resolve(candidate);
      return route && routes.get(route.data.key)?.route === route ? route : null;
    },
    bindings(candidate: unknown) {
      return resolveRouteBindings(admissions, candidate);
    },
    subscribe(listener: () => void) {
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
