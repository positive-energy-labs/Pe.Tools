import { useSyncExternalStore } from "react";
import { publicRoutes } from "../route/route-discovery";
import type { AdmittedAddressPort } from "../shell/typed-address";
import { subjectCode } from "@pe/agent-contracts";
import type { TypedRoute } from "../route/typed-route";
export interface HostedRouteProps {
  thread: string;
  visible: boolean;
  target?: string;
  work?: string;
}
/** A hosted Place never reads or writes the outside router address. */
export function hostedRouteAddress(
  route: TypedRoute,
  { thread, target, work }: HostedRouteProps,
): AdmittedAddressPort {
  let search = new URLSearchParams({ thread, target: target ?? "", work: work ?? "" });
  const listeners = new Set<() => void>();
  const retainSubject = () => {
    const subject = route.spec.subject;
    if (work !== undefined && subject) search.set(subject.field, JSON.stringify(route.spec.fields[subject.field]!.schema.parse({kind:"ids", ids:[subjectCode({ keyKind: "workspace", key: work })]})));
  };
  retainSubject();
  return {
    read: () => new URLSearchParams(search),
    write(next) {
      search = new URLSearchParams(next);
      search.set("thread", thread);
      search.set("target", target ?? "");
      search.set("work", work ?? "");
      retainSubject();
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
/** The workbench consumes the same registration as chat summaries and recorded exits. */
export function HostedRoute({ route, ...props }: HostedRouteProps & { route: string }) {
  useSyncExternalStore(publicRoutes.subscribe, publicRoutes.revision, publicRoutes.revision);
  return publicRoutes.get(route)?.hosted(props) ?? null;
}
