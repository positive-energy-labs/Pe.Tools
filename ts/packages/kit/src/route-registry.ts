import type { ReactNode } from "react";
import { definePlugin, type Plugin, type PluginContext, type WorkKey } from "@pe/agent-contracts";

/** The discoverable projection of a route's full, typed manifest. */
interface RegisteredManifest {
  readonly key: string;
  readonly name: string;
  readonly work?: { readonly title: string };
  readonly cells?: readonly unknown[];
  readonly workKey?: WorkKey | null;
  readonly actions?: Readonly<Record<string, { readonly does?: unknown }>>;
  readonly runs?: readonly string[];
}
type HostedRouteView = (props: { thread: string; visible: boolean }) => ReactNode;
export interface RouteRegistration {
  readonly manifest: RegisteredManifest;
  readonly hosted: HostedRouteView;
}

export const defineRoutePlugin = <M extends RegisteredManifest>(registration: {
  manifest: M;
  hosted: HostedRouteView;
}) =>
  definePlugin<RouteRegistration>({
    id: registration.manifest.key,
    setup: (context) => {
      context.contribute(registration.manifest.key, registration);
    },
  });

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
    register(plugin: Plugin<RouteRegistration>) {
      const cleanup: (() => void)[] = [];
      let active = true;
      const context: PluginContext<RouteRegistration> = {
        id: plugin.id,
        contribute(key, registration) {
          if (!active) throw Error(`route plugin ${plugin.id} is inactive`);
          if (!key.trim() || key !== registration.manifest.key)
            throw Error("a route contribution key must name its manifest");
          if (routes.has(key)) throw Error(`route ${key} is already registered`);
          routes.set(key, registration);
          changed();
          const dispose = () => {
            if (routes.get(key) === registration) {
              routes.delete(key);
              changed();
            }
          };
          cleanup.push(dispose);
          return { dispose };
        },
        hook() {
          throw Error("host lifecycle hooks belong to the host plugin runtime");
        },
      };
      let finalizer: ReturnType<Plugin<RouteRegistration>["setup"]>;
      try {
        finalizer = plugin.setup(context);
        if (finalizer instanceof Promise)
          throw Error("web route setup must register synchronously before mount");
      } catch (error) {
        active = false;
        for (const dispose of cleanup.reverse()) dispose();
        throw error;
      }
      return () => {
        if (!active) return;
        active = false;
        for (const dispose of cleanup.reverse()) dispose();
        if (typeof finalizer === "function") return finalizer();
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
    require(key: string) {
      const registration = routes.get(key);
      if (!registration) throw Error(`route ${key} is not registered`);
      return registration;
    },
    actionRoute(key: string): string | null {
      const owners = [...routes.values()].filter(
        ({ manifest }) =>
          manifest.runs?.includes(key) ||
          Object.values(manifest.actions ?? {}).some((action) => action.does === key),
      );
      return owners.length === 1 ? owners[0]!.manifest.key : null;
    },
  };
}
