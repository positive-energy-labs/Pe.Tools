import { createContext, useSyncExternalStore } from "react";
import { publicRoutes } from "../route/route-discovery";
import type { AdmittedAddressPort } from "../shell/typed-address";
import { subjectCode } from "@pe/agent-contracts";
import type { TypedRoute } from "@pe/web-kernel/route/typed-route";
export type DockSurfaceProps = { target?: string; docked?: boolean };
export const DockSurface = createContext<DockSurfaceProps>({});
export function dockChatAddress(address: AdmittedAddressPort): AdmittedAddressPort {
  // Fixture pages prohibit host transport; Pea uses the same attach seed as its workbench provider.
  return {
    read() {
      const search = new URLSearchParams(address.read());
      if (search.has("fixture")) search.set("fixture", "attach");
      return search;
    },
    write(next, history) {
      const search = new URLSearchParams(next);
      const fixture = address.read().get("fixture");
      if (fixture === null) search.delete("fixture");
      else search.set("fixture", fixture);
      address.write(search, history);
    },
    subscribe: (listener) => address.subscribe(listener),
  };
}
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
    if (work !== undefined && subject)
      search.set(
        subject.field,
        JSON.stringify(
          route.spec.fields[subject.field]!.schema.parse({
            kind: "ids",
            ids: [subjectCode({ keyKind: "workspace", key: work })],
          }),
        ),
      );
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
