import { DocumentPicker } from "./document-picker";
import { createElement, useState, useMemo, useRef, useSyncExternalStore, Fragment } from "react";
import { historyRequest, publicationPose, type HistorySnapshot } from "./history.ts";
import { HistoryBoundary, HistoryRail } from "./history-rail.tsx";
import { RouteDocument } from "./admitted-chrome";
import { targetInventory } from "../host/resource-state";
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
import { useRouteTarget, parseTarget } from "../route/route-target";
import { appAtomRegistry } from "./owner";
import type { PlaceInput } from "./typed-place";

/** Resolve application inputs only after Place custody; target changes retire the mounted owner. */
function ApplicationRouteShell(props: Omit<AdmittedPaneProps, "shell">) {
  return createElement(AdmittedPlaceBoundary, {
    route: props.route,
    address: props.address,
    children: (place) => createElement(HistoryBoundary, { address: place.address, children: (snapshot) => createElement(PlaceRouteShell, { route: props.route, place, snapshot }) }),
  });
}

export function PlaceRouteShell({
  route,
  place,
  snapshot,
}: Pick<AdmittedPaneProps, "route"> & { place: PanePlace; snapshot?: HistorySnapshot }) {
  const address = place.address;
  const search = useSyncExternalStore(
    (notify) => address.subscribe(notify),
    () => address.read().toString(),
    () => address.read().toString(),
  );
  const params = new URLSearchParams(search);
  const fixture = place.fixture;
  const compare = !!snapshot && params.get("compare") === "now";
  const history = compare ? undefined : snapshot;
  const [liveInstance] = useState(() => `${route.data.key}:${crypto.randomUUID()}`);
  const candidates = snapshot?.point.history.poses.filter((p) => p.route === route.data.key && (!params.get("atInstance") || p.instance === params.get("atInstance"))) ?? [];
  const recordedPose = candidates.length === 1 ? candidates[0] : undefined;
  const instance = recordedPose?.instance ?? liveInstance;
  const pin = compare ? snapshot.point.history.address : params.get("target");
  // Like useWorkScope: an optional target acquires authority only when pinned. No pin browses host.
  const required = route.data.needs === "nothing" ? undefined : route.data.needs;
  const needs = required ?? (pin ? route.data.optionalTarget : undefined);
  const selected = useRouteTarget(
    { needs: needs === "session" ? "document" : needs },
    appAtomRegistry,
    history ? { target: { kind: "document", ref: history.point.history.target } } : fixture !== null || !needs ? {} : undefined,
    pin,
  );
  const sessionPin = needs === "session" ? parseTarget(pin) : null;
  const sessionInventory = sessionPin?.kind === "session" ? targetInventory(
    selected.inventoryResult as Parameters<typeof targetInventory>[0],
  ) : null;
  const session =
    sessionPin?.kind === "session" && sessionInventory?.kind === "ready"
      ? sessionInventory.sessions[sessionPin.session]
      : null;
  // A session target need not contain an open document; preserve the legacy exact-session path.
  const resolved =
    sessionPin?.kind === "session"
      ? session?.kind === "ready"
        ? { kind: "session" as const, session: sessionPin.session }
        : null
      : selected.resolution.kind === "resolved"
        ? selected.resolution.target
        : null;
  const resolution = JSON.stringify([resolved, selected.workAddress, selected.workOpen, history?.point.id, !!snapshot, instance]);
  const currentResolution = useRef(resolution);
  currentResolution.current = resolution;
  const input = useMemo<PlaceInput>(
    () => ({
      address,
      fixture,
      history,
      readOnly: !!snapshot,
      target: resolved,
      work: {
        address: history?.point.history.address ?? selected.workAddress,
        open: resolved?.kind === "document" ? resolved.ref : selected.workOpen,
      },
      // The route may keep its raw Address while its resolved document lifetime changes.
      custody: { current: () => place.current() && currentResolution.current === resolution },
      memory: history ? () => recordedPose?.page ?? {} : place.memory,
    }),
    [place, resolution],
  );
  const page = useRef<Record<string, unknown>>({});
  const lastPose = useRef("");
  const shell = useMemo(() => createRouteShell(sourceRouteServices(admittedSources(route), {}, {
    point: history?.point.id,
    pose: () => publicationPose(instance, route.data.key, page.current),
  })), [route, history?.point.id, instance]);
  const document = createElement(DocumentPicker, {
    place,
    target: resolved,
    needs: required ?? route.data.optionalTarget ?? "nothing",
    enabled: fixture === null && !history && !!(required ?? route.data.optionalTarget),
  });
  if (snapshot && !recordedPose) return createElement("p", { role: "status" }, "This route was never published at this point, or its Page is ambiguous");
  if (!resolved && !input.work.address && !input.work.open)
    return createElement(
      Fragment,
      null,
      document,
      createElement(OutcomeLine, {
        kind: "error",
        label: "Choose a document",
        says: selected.resolution.kind,
      }),
    );
  return createElement(
    RouteDocument.Provider,
    { value: document },
    createElement(HistoryRail, { document: snapshot?.point.history.address ?? selected.workAddress, route: route.data.key, address, snapshot, compare }),
    createElement("section", { className: "flex min-h-0 flex-1 flex-col", "data-tone": history ? "caution" : undefined, "data-wash": history ? "" : undefined, "aria-label": history ? "Recorded view, read-only" : undefined }, createElement(AdmittedPlacePane, {
      shell,
      route,
      place,
      input,
      onPage: (value: Record<string, unknown>) => {
        page.current = value;
        if (!history && selected.workAddress && fixture === null) {
          const pose = publicationPose(instance, route.data.key, value);
          const signature = JSON.stringify([selected.workAddress, pose]);
          if (signature !== lastPose.current) {
            lastPose.current = signature;
            void historyRequest("", { kind: "page", document: selected.workAddress, pose }).catch(() => {});
          }
          window.dispatchEvent(new Event("pe:history-change"));
        }
      },
    })),
  );
}

export { ApplicationRouteShell as applicationRouteShell };
