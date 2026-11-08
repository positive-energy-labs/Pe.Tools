import { useContext, useRef, useState, useEffect, type ReactNode } from "react";
import { RouteVisibility, useRouteActivity } from "../route/activity";
import { createAdmittedPlace, type AdmittedPlace } from "./typed-place";
import type { AdmittedAddressPort } from "./typed-address";

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

export function PlaceBoundary<State extends {dispose(): void}>({
  identity,
  path,
  address,
  children,
}: {
  identity: object;
  path: string;
  address: AdmittedAddressPort;
  children: (place: AdmittedPlace<State>) => ReactNode;
}) {
  const scope = useRouteActivity();
  const visible = useContext(RouteVisibility);
  const held = useRef<AdmittedPlace<State> | null>(null);
  const lifetime = useRef({ identity, address, scope });
  const [ready, setReady] = useState<AdmittedPlace<State> | null>(null);
  useEffect(() => {
    let place = held.current;
    if (place && (lifetime.current.identity !== identity || lifetime.current.scope !== scope || lifetime.current.address !== address)) {
      if (lifetime.current.scope) lifetime.current.scope.retire(place);
      else place.dispose();
      place = null;
      held.current = null;
    }
    if (!place) {
      lifetime.current = { identity, address, scope };
      const captured = scope
        ? new URLSearchParams(
            Object.entries(scope.search).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : address.read();
      place = createAdmittedPlace<State>({
        scope: scope ?? {
          pathname: path,
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
  }, [identity, address, scope, visible, path]);
  return ready && lifetime.current.identity === identity && lifetime.current.address === address
    ? children(ready)
    : null;
}
