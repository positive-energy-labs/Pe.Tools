import { createElement, useEffect, useState, useMemo, useRef, useSyncExternalStore, Fragment } from "react";
import { historyRequest, historySnapshotSchema, publicationPose, type HistorySnapshot } from "./history.ts";
import { HistoryRail } from "./history-rail.tsx";
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
    children: (place) => createElement(HistoryPlace, { route: props.route, place }),
  });
}

function HistoryPlace({ route, place }: Pick<AdmittedPaneProps, "route"> & { place: PanePlace }) {
  const search = useSyncExternalStore((notify) => place.address.subscribe(notify), () => place.address.read().toString(), () => "");
  const at = new URLSearchParams(search).get("at");
  const [loaded, setLoaded] = useState<{ id: string; snapshot?: HistorySnapshot; error?: string } | null>(null);
  useEffect(() => {
    if (!at) return;
    let closed = false;
    void historyRequest(`?at=${encodeURIComponent(at)}`).then((raw) => {
      if (!closed) setLoaded({ id: at, snapshot: historySnapshotSchema.parse(raw) });
    }).catch((error) => { if (!closed) setLoaded({ id: at, error: String(error) }); });
    return () => { closed = true; };
  }, [at]);
  if (at && (loaded?.id !== at || !loaded.snapshot)) return createElement("div", { role: "status", "data-tone": "caution" },
    loaded?.id === at ? loaded.error : "Opening recorded point…");
  return createElement(PlaceRouteShell, { route, place, snapshot: at ? loaded!.snapshot : undefined });
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
