/**
 * The Works the Chat head summarizes: every plugin route's Work, read by the key its manifest
 * declares (`useRouteWorks`, the same Work atom the route's pane reads), one head Work per declared
 * cell head with pending cells. Every exit opens that route in the plugin pane.
 */
import { useState, useSyncExternalStore, useMemo } from "react";
import type {
  Address,
  DocumentRef,
  RouteStatePatch,
  TrichotomyCellLike,
  WorkKey,
} from "@pe/agent-contracts";

import type { Cells } from "#/route/cells";
import type { RouteManifest } from "#/route/manifest";
import { useRouteWorks } from "#/route/route-work";
import {
  capturedPlace,
  chatPluginTitle,
  type CapturedPlace,
  type ChatPluginRoute,
} from "#/workbench/chat-plugins";

import { publicRoutes } from "#/route/builtin-routes";
import type { HeadWork } from "./proposal-head";

export interface HeadExits {
  open: (place: Extract<CapturedPlace, { ok: true }>) => void;
  planIn: (place: Extract<CapturedPlace, { ok: true }>) => void;
  /** The head's last plan, refused in its hosted route. */
  planRefusal?: { route: ChatPluginRoute; message: string } | null;
}

type Doc = Record<string, unknown>;
type Manifest = RouteManifest<Doc, string, unknown, string>;

const keyOf = (
  manifest: Manifest,
  address: Address | null,
  document: DocumentRef | null,
): WorkKey | null =>
  manifest.workKey ??
  (address
    ? {
        binding: "address" as const,
        route: manifest.key,
        target: address,
        ...(document ? { from: document } : {}),
      }
    : null);

const pending = (cell: TrichotomyCellLike | undefined) =>
  cell != null && (cell.proposal != null || cell.staged != null);

export function useHeadWorks(
  address: Address | null,
  subject: string,
  exits: HeadExits,
  document: DocumentRef | null = null,
): HeadWork[] {
  const revision = useSyncExternalStore(
    publicRoutes.subscribe,
    publicRoutes.revision,
    publicRoutes.revision,
  );
  const headed = useMemo(
    () =>
      publicRoutes.entries().flatMap(({ manifest: registered }) => {
        const manifest = registered as unknown as Manifest;
        return manifest.work && manifest.cells?.length && manifest.workKey !== null
          ? [
              {
                route: manifest.key,
                manifest,
                cells: manifest.cells,
                spec: manifest.work,
                key: keyOf(manifest, address, document),
              },
            ]
          : [];
      }),
    [revision, address, document?.session, document?.openId],
  );
  const summaries = useRouteWorks(headed);
  // A refused bound write is a foreign write landing first: say it, and offer reload.
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set());
  const [openRefusal, setOpenRefusal] = useState<{ route: string; message: string } | null>(null);
  const conflict = (route: string, on: boolean) =>
    setConflicts((now) => {
      if (now.has(route) === on) return now;
      const next = new Set(now);
      if (on) next.add(route);
      else next.delete(route);
      return next;
    });
  const works = headed.map((one, index) => ({ ...one, work: summaries[index]! }));
  return works.flatMap(({ route, manifest, work, cells: heads }) => {
    const doc = work.doc as Doc | null;
    if (!doc || !publicRoutes.get(route)) return [];
    const key = keyOf(manifest, address, document);
    const place = capturedPlace(route, key, doc);
    const open = (plan: boolean, focus?: readonly string[]) => {
      const refusal = focus?.length
        ? "This group path did not record a route subject; open the route and choose its subject."
        : place.ok
          ? null
          : place.refusal;
      if (refusal) {
        setOpenRefusal({ route, message: refusal });
        return;
      }
      if (!place.ok) return;
      setOpenRefusal(null);
      if (plan) exits.planIn(place);
      else exits.open(place);
    };
    return heads.flatMap((head: Cells<Doc>): HeadWork[] => {
      const cells = (
        head.segment === null ? { [head.key!]: doc[head.key!] } : (doc[head.segment] ?? {})
      ) as Record<string, TrichotomyCellLike | undefined>;
      if (!Object.values(cells).some(pending)) return [];
      const plan = head.commit === "plan";
      return [
        {
          id: `${JSON.stringify(key)}:${head.segment ?? head.key}`,
          route: chatPluginTitle(route),
          subject: head.noun ?? subject,
          cells: cells as Record<string, TrichotomyCellLike>,
          wire: {
            segment: head.segment,
            revision: work.revision,
            write: async (patches: RouteStatePatch[], expectedRevision?: number) => {
              const refused = head.admit?.(doc, patches);
              if (refused) return refused;
              const refusal = await work.write(patches, expectedRevision);
              conflict(route, refusal?.code === "stale-revision");
              return refusal;
            },
          },
          groupOf: head.groupOf,
          ...(head.show ? { show: head.show } : {}),
          stale: work.stale,
          conflict: conflicts.has(route),
          reload: () => {
            conflict(route, false);
            work.reload();
          },
          commit: plan
            ? { word: "apply", run: () => open(true) }
            : { word: "open", run: () => open(false) },
          open: (focus) => open(false, focus),
          // A planned Work commits whole: all its cells are one head line (F-B-4).
          ...(plan ? { line: `${route}:${JSON.stringify(key)}` } : {}),
          ...(exits.planRefusal?.route === route ? { refusal: exits.planRefusal.message } : {}),
          ...(!place.ok ? { refusal: place.refusal } : {}),
          ...(openRefusal?.route === route ? { refusal: openRefusal.message } : {}),
        },
      ];
    });
  });
}
