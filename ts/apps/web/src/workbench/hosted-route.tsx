import { z } from "zod";
import {
  createAdmittedRouteRegistry,
  resolveRouteBindings,
} from "../../../../packages/agent-contracts/src/route-module";
import { routeWorkSubject } from "../../../../packages/agent-contracts/src/route-work-subject";
import { useMemo, useSyncExternalStore } from "react";
import { publicRoutes } from "../route/route-discovery";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { AdmittedAddressPort } from "../shell/admitted-address";
import { applicationRouteShell as ApplicationRouteShell } from "../shell/application-route-shell";
export interface HostedRouteProps {
  thread: string;
  visible: boolean;
  target?: string;
  work?: string;
}
/** A hosted Place never reads or writes the outside router address. */
export function hostedRouteAddress(
  route: AdmittedRoute | import("../route/typed-route").TypedRoute,
  { thread, target, work }: HostedRouteProps,
): AdmittedAddressPort {
  let search = new URLSearchParams({ thread, target: target ?? "", work: work ?? "" });
  const listeners = new Set<() => void>();
  if (work !== undefined && !("spec" in route) && route.data.workSubject) {
    const registry = createAdmittedRouteRegistry();
    const registration = registry.register(route);
    try {
      const bindings = resolveRouteBindings(registry, route)!;
      const field = route.data.fields[route.data.workSubject]!;
      if (field.role !== "subject") throw Error("Work subject must be a subject field");
      const codec = bindings.codecs[field.codec]!;
      const decoded = z
        .object({ ok: z.literal(true), value: z.unknown() })
        .parse(codec.decode(work));
      const value = bindings.schemas[field.schema]!.parse(decoded.value);
      if (routeWorkSubject(route.data, bindings, { [route.data.workSubject]: value }) !== work)
        throw Error("Hosted Work subject differs from recorded Work");
      search.set(route.data.workSubject, z.string().parse(codec.encode(value)));
    } finally {
      registration.deactivate();
    }
  }
  return {
    read: () => new URLSearchParams(search),
    write(next) {
      search = new URLSearchParams(next);
      search.set("thread", thread);
      search.set("target", target ?? "");
      search.set("work", work ?? "");
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export function HostedAdmittedRoute({
  route,
  ...props
}: HostedRouteProps & { route: AdmittedRoute }) {
  const address = useMemo(
    () => hostedRouteAddress(route, props),
    [route, props.thread, props.target, props.work],
  );
  return props.visible ? (
    <ApplicationRouteShell route={route} address={address} />
  ) : null;
}
/** The workbench consumes the same registration as chat summaries and recorded exits. */
export function HostedRoute({ route, ...props }: HostedRouteProps & { route: string }) {
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  return publicRoutes.get(route)?.hosted(props) ?? null;
}
