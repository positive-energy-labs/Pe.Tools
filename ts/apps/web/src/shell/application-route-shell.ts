import { createElement, useMemo, useRef, useSyncExternalStore } from "react";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { createRouteShell } from "./admitted-mount";
import {
  AdmittedPlaceBoundary,
  AdmittedPlacePane,
  type AdmittedPaneProps,
  type PanePlace,
} from "./admitted-pane";
import { sourceRouteServices } from "./source-route-services";
import { admittedSources } from "./admitted-sources";
import { useRouteTarget } from "../route/route-target";
import { appAtomRegistry } from "./owner";
import type { PlaceInput } from "./admitted-place";

/** Resolve application inputs only after Place custody; target changes retire the mounted owner. */
function ApplicationRouteShell(props: Omit<AdmittedPaneProps, "shell">) {
  return createElement(AdmittedPlaceBoundary, {
    route: props.route,
    address: props.address,
    children: (place) => createElement(PlaceRouteShell, { route: props.route, place }),
  });
}

function PlaceRouteShell({
  route,
  place,
}: Pick<AdmittedPaneProps, "route"> & { place: PanePlace }) {
  const address = place.address;
  const search = useSyncExternalStore(
    (notify) => address.subscribe(notify),
    () => address.read().toString(),
    () => address.read().toString(),
  );
  const params = new URLSearchParams(search);
  const fixture = place.fixture;
  const selected = useRouteTarget(
    { needs: route.data.needs === "nothing" ? undefined : route.data.needs },
    appAtomRegistry,
    fixture !== null || route.data.needs === "nothing" ? {} : undefined,
    params.get("target"),
  );
  const resolved = selected.resolution.kind === "resolved" ? selected.resolution.target : null;
  const resolution = JSON.stringify([resolved, selected.workAddress, selected.workOpen]);
  const currentResolution = useRef(resolution);
  currentResolution.current = resolution;
  const input = useMemo<PlaceInput>(
    () => ({
      address,
      fixture,
      target: resolved,
      work: {
        address: selected.workAddress,
        open: resolved?.kind === "document" ? resolved.ref : selected.workOpen,
      },
      // The route may keep its raw Address while its resolved document lifetime changes.
      custody: { current: () => place.current() && currentResolution.current === resolution },
      memory: place.memory,
    }),
    [place, resolution],
  );
  const shell = useMemo(
    () => createRouteShell(sourceRouteServices(admittedSources(route))),
    [route],
  );
  if (!resolved && !input.work.address && !input.work.open)
    return createElement(OutcomeLine, {
      kind: "error",
      label: "Choose a document",
      says: selected.resolution.kind,
    });
  return createElement(AdmittedPlacePane, {
    shell,
    route,
    place,
    input,
  });
}

export { ApplicationRouteShell as applicationRouteShell };
