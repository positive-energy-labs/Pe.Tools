import { useContext, useRef } from "react";
import { RouteVisibility, useRouteActivity } from "../route/activity";
import { createAdmittedPlace, type AdmittedPlace, type PlaceInput } from "./admitted-place";
import { AdmittedChrome } from "./admitted-chrome";
import { useRouteViewBridge } from "../route/view-bridge";
import { refuse } from "../route/refusal";
import { useRouter } from "@tanstack/react-router";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Button } from "@pe/kit/lang/button";
import {
  createElement,
  Fragment,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from "react";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import { type AdmittedMount, createRouteShell } from "./admitted-mount";
import type { AdmittedAddressPort } from "./admitted-address";

/** The router's existing history is the only URL owner; writes also notify Back/Forward listeners. */
export function admittedRouterAddress(history: {
  readonly location: {
    readonly search: string;
    readonly pathname: string;
    readonly hash: string;
    readonly state?: unknown;
  };
  push(href: string, state?: unknown): void;
  replace(href: string, state?: unknown): void;
  subscribe(listener: () => void): () => void;
}): AdmittedAddressPort {
  return {
    read: () => new URLSearchParams(history.location.search),
    write(search, mode) {
      const query = search.toString();
      // Carry the entry's state: a dropped route-tab tag left the tab without custody until re-render.
      history[mode](
        `${history.location.pathname}${query ? `?${query}` : ""}${history.location.hash}`,
        history.location.state,
      );
    },
    subscribe: (listener) => history.subscribe(listener),
  };
}

/** Opt-in attention (ADR 0030 rule 10): the lease transport carries the admission's own codec. */
export function AdmittedAttention({
  mount,
  route,
  codec,
}: {
  mount: AdmittedMount;
  route: AdmittedRoute;
  codec: NonNullable<AdmittedMount["attention"]>;
}) {
  useSyncExternalStore(mount.subscribe, mount.revision, mount.revision);
  useRouteViewBridge({
    route: route.data.key,
    page: mount.page.read() as object,
    surface: "route",
    codec,
    visible: useContext(RouteVisibility),
    context: {},
    facts: {},
    apply: (patch) => {
      const result = mount.peaMove(patch as Record<string, unknown>);
      return result.kind === "refused"
        ? { ok: false, refusal: refuse("not-ready", result.message) }
        : { ok: true, moved: result.changed, receipt: result.receipt };
    },
  });
  return null;
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
}

type PlaceMount = {
  shell: ReturnType<typeof createRouteShell>;
  mount: AdmittedMount;
  input: PlaceInput;
  dispose(): void;
};
export type PanePlace = AdmittedPlace<PlaceMount>;

/** Establish Place custody before any application input is resolved. */
export function AdmittedPlaceBoundary({
  route,
  address,
  children,
}: {
  route: AdmittedRoute;
  address: AdmittedAddressPort;
  children: (place: PanePlace) => ReactNode;
}) {
  const scope = useRouteActivity();
  const visible = useContext(RouteVisibility);
  const held = useRef<PanePlace | null>(null);
  const lifetime = useRef({ route, address });
  const [ready, setReady] = useState<PanePlace | null>(null);
  useEffect(() => {
    let place = held.current;
    if (place && (lifetime.current.route !== route || lifetime.current.address !== address)) {
      if (scope) scope.retire(place);
      else place.dispose();
      place = null;
      held.current = null;
    }
    if (!place) {
      lifetime.current = { route, address };
      const captured = scope
        ? new URLSearchParams(
            Object.entries(scope.search).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : address.read();
      place = createAdmittedPlace<PlaceMount>({
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
    setReady(place);
    return () => {
      place.setVisible(false);
      if (!scope) {
        place.dispose();
        held.current = null;
      }
    };
  }, [route, address, scope, visible]);
  return ready && lifetime.current.route === route && lifetime.current.address === address
    ? children(ready)
    : null;
}

/** Composition runs after commit, including StrictMode cleanup/remount. */
export function AdmittedPlacePane({
  shell,
  route,
  place,
  input,
}: Omit<AdmittedPaneProps, "address"> & {
  place: PanePlace;
  input: PlaceInput;
}) {
  const visible = useContext(RouteVisibility);
  const [mounted, setMounted] = useState<PlaceMount | null>(null);
  useEffect(() => {
    // Child effects resume before the boundary's effect; subscriptions must see visible custody.
    place.setVisible(visible);
    const state = place.state(() => ({
      shell,
      input,
      mount: shell.mount(route, input),
      dispose() {
        this.mount.dispose();
      },
    }));
    if (state.shell !== shell || state.input !== input) {
      state.mount.dispose();
      place.remember({});
      state.shell = shell;
      state.input = input;
      state.mount = shell.mount(route, input);
    }
    const { mount } = state;
    const publish = () => place.remember(mount.page.read());
    publish();
    const unsubscribe = mount.subscribe(publish);
    setMounted({ ...state });
    return () => {
      unsubscribe();
      mount.release();
    };
  }, [shell, route, place, visible, input]);
  return mounted?.shell === shell
    ? createElement(
        Fragment,
        null,
        mounted.mount.attention &&
          createElement(AdmittedAttention, {
            mount: mounted.mount,
            route,
            codec: mounted.mount.attention,
          }),
        createElement(Pane, { mount: mounted.mount, route }),
      )
    : null;
}

/** Preserve router values; the address reads codec text from raw history. */
export function admittedRouteSearch<
  G extends import("../../../../packages/agent-contracts/src/route-kernel-data").RouteGraphJson,
>(_data: G) {
  return (
    search: Record<string, unknown>,
  ): { [K in keyof G["fields"]]?: unknown } & { fixture?: unknown } => search;
}

/** Shared async admission/router boundary. Domain routes supply only a loader. */
export function AdmittedRouteView({
  shell,
  load,
}: {
  shell: ComponentType<Omit<AdmittedPaneProps, "shell">>;
  load: () => Promise<AdmittedRoute>;
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
    ? createElement(shell, { route, address })
    : createElement("p", null, "Reading route...");
}
