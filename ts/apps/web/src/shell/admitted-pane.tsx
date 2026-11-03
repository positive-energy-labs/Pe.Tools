import { useContext, useRef } from "react";
import { RouteVisibility, useRouteActivity } from "../route/activity";
import { createAdmittedPlace, type AdmittedPlace } from "./admitted-place";
import { AdmittedChrome } from "./admitted-chrome";
import { useRouter } from "@tanstack/react-router";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import {
  createElement,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
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

function Pane({ mount, route }: { mount: AdmittedMount; route: AdmittedRoute }) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  const recovery = mount.recovery();
  const failure = mount.workFailure();
  const problem = mount.workProblem();
  const workMessage =
    failure?.kind === "registration-mismatch"
      ? "This tab is running an older version of this route; reload."
      : (failure?.message ?? problem);
  return createElement(
    AdmittedChrome,
    { key: route.data.key, mount, data: route.data },
    (recovery.sentence ?? workMessage) &&
      createElement(OutcomeLine, {
        kind: "error",
        label: failure?.kind ?? "Work unavailable",
        says: recovery.sentence ?? workMessage!,
      }),
    recovery.problem &&
      createElement(OutcomeLine, { kind: "error", label: "Work recovery", says: recovery.problem }),
    recovery.startFresh &&
      createElement(
        Button,
        {
          label: "Start fresh",
          refusal: recovery.busy ? "Recovery is in progress" : null,
          onClick: () => {
            void mount.startFresh().catch(() => {});
          },
        },
        "Start fresh",
      ),
    recovery.carryOver &&
      createElement(
        Button,
        {
          label: "Carry over",
          refusal: recovery.busy ? "Recovery is in progress" : null,
          onClick: () => {
            void mount.salvage().catch(() => {});
          },
        },
        "Carry over",
      ),
    ...mount.commandProblems().map((problem) =>
      createElement(OutcomeLine, {
        key: problem.receiptId,
        kind: "error",
        label: "result-undecodable",
        says: `${problem.key}: ${problem.problem}`,
      }),
    ),
  );
}

export interface AdmittedPaneProps {
  shell: ReturnType<typeof createRouteShell>;
  route: AdmittedRoute;
  address: AdmittedAddressPort;
  pane: string;
  writable?: boolean;
}

/** Composition runs after commit, including StrictMode cleanup/remount. No owner publishes in render. */
export function AdmittedPane({ shell, route, address, writable = true }: AdmittedPaneProps) {
  const scope = useRouteActivity();
  const visible = useContext(RouteVisibility);
  const held = useRef<AdmittedPlace<AdmittedMount> | null>(null);
  const lifetime = useRef({ shell, route, address });
  const [mounted, setMounted] = useState<{
    route: AdmittedRoute;
    shell: ReturnType<typeof createRouteShell>;
    mount: AdmittedMount;
  } | null>(null);
  useEffect(() => {
    let place = held.current;
    if (
      place &&
      (lifetime.current.shell !== shell ||
        lifetime.current.route !== route ||
        lifetime.current.address !== address)
    ) {
      if (scope) scope.retire(place);
      else place.dispose();
      place = null;
      held.current = null;
    }
    if (!place) {
      lifetime.current = { shell, route, address };
      const captured = scope
        ? new URLSearchParams(
            Object.entries(scope.search).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : address.read();
      place = createAdmittedPlace<AdmittedMount>({
        scope: scope ?? {
          pathname: route.data.address,
          search: Object.fromEntries(captured),
          current: () => true,
          retain() {},
          retire() {},
        },
        address,
        search: captured,
        visible,
      });
      held.current = place;
    }
    place.setVisible(visible);
    const mount = place.state(() => shell.mount(route, place.address, () => place.memory()));
    mount.setVisible(visible);
    mount.setWritable(writable);
    const publish = () => {
      place.remember(mount.page.read());
    };
    publish();
    const unsubscribe = mount.subscribe(publish);
    setMounted({ route, shell, mount });
    return () => {
      unsubscribe();
      place.setVisible(false);
      mount.setVisible(false);
      if (!scope) {
        place.dispose();
        held.current = null;
      }
    };
  }, [shell, route, address, scope, visible, writable]);
  return mounted?.route === route && mounted.shell === shell
    ? createElement(Pane, { mount: mounted.mount, route })
    : null;
}

/** Router search stays codec text; field names and types come from the admitted declaration. */
export function admittedRouteSearch<
  G extends import("../../../../packages/agent-contracts/src/route-kernel-data").RouteGraphJson,
>(_data: G) {
  return (search: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(search).map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      ]),
    ) as { [K in keyof G["fields"]]?: string } & { fixture?: string };
}

/** Shared async admission/router boundary. Domain routes supply only a loader and pane id. */
export function AdmittedRouteView({
  shell,
  load,
  pane,
}: {
  shell: ReturnType<typeof createRouteShell> | ComponentType<Omit<AdmittedPaneProps, "shell">>;
  load: () => Promise<AdmittedRoute>;
  pane: string;
}) {
  const router = useRouter();
  const address = useMemo(() => admittedRouterAddress(router.history), [router]);
  const [route, setRoute] = useState<AdmittedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let retired = false;
    setRoute(null);
    setError(null);
    void load()
      .then((route) => {
        if (!retired) setRoute(route);
      })
      .catch((cause: unknown) => {
        if (!retired) setError(String(cause));
      });
    return () => {
      retired = true;
    };
  }, [load]);
  if (error)
    return createElement(OutcomeLine, { kind: "error", label: "route refused", says: error });
  return route
    ? typeof shell === "function"
      ? createElement(shell, { route, address, pane })
      : createElement(AdmittedPane, { shell, route, address, pane })
    : createElement("p", null, "Reading route...");
}
