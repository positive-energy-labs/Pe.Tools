import { createElement, useMemo, useRef, useSyncExternalStore, Fragment } from "react";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { RouteDocument } from "./admitted-chrome";
import { inventoryOf, previousOf, useInventory, targetInventory } from "./readings-hooks";
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
import type { PlaceInput } from "./admitted-place";

/** Resolve application inputs only after Place custody; target changes retire the mounted owner. */
function ApplicationRouteShell(props: Omit<AdmittedPaneProps, "shell">) {
  return createElement(AdmittedPlaceBoundary, {
    route: props.route,
    address: props.address,
    children: (place) => createElement(PlaceRouteShell, { route: props.route, place }),
  });
}

export function PlaceRouteShell({
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
  const pin = params.get("target");
  // Like useWorkScope: an optional target acquires authority only when pinned. No pin browses host.
  const required = route.data.needs === "nothing" ? undefined : route.data.needs;
  const needs = required ?? (pin ? route.data.optionalTarget : undefined);
  const selected = useRouteTarget(
    { needs: needs === "session" ? "document" : needs },
    appAtomRegistry,
    fixture !== null || !needs ? {} : undefined,
    pin,
  );
  const sessionPin = needs === "session" ? parseTarget(pin) : null;
  const sessionInventory = targetInventory(
    selected.inventoryResult as Parameters<typeof targetInventory>[0],
  );
  const session =
    sessionPin?.kind === "session" && sessionInventory.kind === "ready"
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
  const document = createElement(DocumentPicker, {
    place,
    target: resolved,
    needs: required ?? route.data.optionalTarget ?? "nothing",
    enabled: fixture === null && !!(required ?? route.data.optionalTarget),
  });
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
    createElement(AdmittedPlacePane, {
      shell,
      route,
      place,
      input,
    }),
  );
}

export { ApplicationRouteShell as applicationRouteShell };

/** A choice pins this Place to an exact open lifetime; it never changes the chat's targets. */
export function DocumentPicker({
  place,
  target,
  needs,
  enabled,
}: {
  place: PanePlace;
  target: PlaceInput["target"];
  needs: string;
  enabled: boolean;
}) {
  const inventory = useInventory(enabled);
  if (!enabled) return null;
  const options = inventoryOf(previousOf(inventory)?.sessions ?? []).flatMap((session) =>
    (session.openDocuments ?? [])
      .filter(
        (doc) =>
          (needs !== "project" && needs !== "family") ||
          doc.isFamilyDocument === (needs === "family"),
      )
      .map((doc) => ({
        ref: { session: session.sessionId, openId: doc.openId },
        label: doc.title,
        session:
          session.sdkSessionId ??
          `Revit${session.processId === null ? "" : ` - pid ${session.processId}`}`,
      })),
  );
  const key = (ref: { session: string; openId: string }) => JSON.stringify(ref);
  const selected = target?.kind === "document" ? key(target.ref) : null;
  return createElement(ListPopup<(typeof options)[number]>, {
    anchor: "trigger",
    face: "control",
    triggerLabel: "Choose a document",
    trigger: options.find((option) => key(option.ref) === selected)?.label ?? "Choose a document",
    "aria-label": "Document",
    items: options,
    keyOf: (option) => key(option.ref),
    labelOf: (option) => option.label,
    filter: "substring",
    select: "single",
    selected: selected ? [selected] : [],
    empty: inventory.state === "loading" ? "Reading documents..." : "No open documents available",
    row: (option) => ({ label: option.label, sub: option.session }),
    onPick: (option) => {
      const search = place.address.read();
      search.set("target", JSON.stringify({ kind: "open", ref: option.ref }));
      place.address.write(search, "push");
    },
  });
}
