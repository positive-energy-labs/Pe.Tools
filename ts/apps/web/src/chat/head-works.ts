/**
 * The Works the Chat head summarizes: every plugin route's Work, read by the key its manifest
 * declares (`useRouteWork`, the same Work atom the route's pane reads), one head Work per declared
 * cell head with pending cells. Every exit opens that route in the plugin pane.
 */
import { useState } from "react";
import type { Address, RouteStatePatch, TrichotomyCellLike, WorkKey } from "@pe/agent-contracts";

import type { Cells } from "#/route/cells";
import type { RouteManifest } from "#/route/manifest";
import { useRouteWork } from "#/route/route-work";
import {
  CHAT_PLUGIN_ROUTES,
  CHAT_PLUGINS,
  chatPluginTitle,
  type ChatPluginRoute,
} from "#/workbench/chat-plugins";

import type { HeadWork } from "./proposal-head";

export interface HeadExits {
  open: (route: ChatPluginRoute, focus?: readonly string[]) => void;
  planIn: (route: ChatPluginRoute) => void;
  /** The head's last plan, refused in its hosted route. */
  planRefusal?: { route: ChatPluginRoute; message: string } | null;
}

type Doc = Record<string, unknown>;
type Manifest = RouteManifest<Doc, string, unknown, string>;

/** The plugin routes whose Work declares cells the head can key; a module constant, so the hook
 * order below never changes. */
const HEADED = CHAT_PLUGIN_ROUTES.flatMap((route) => {
  const manifest = CHAT_PLUGINS[route] as unknown as Manifest;
  const { work, cells } = manifest;
  return work && cells?.length && manifest.workKey !== null
    ? [{ route, manifest, spec: work, cells }]
    : [];
});

const keyOf = (manifest: Manifest, address: Address | null): WorkKey | null =>
  manifest.workKey ??
  (address ? { binding: "address" as const, route: manifest.key, target: address } : null);

const pending = (cell: TrichotomyCellLike | undefined) =>
  cell != null && (cell.proposal != null || cell.staged != null);

export function useHeadWorks(
  address: Address | null,
  subject: string,
  exits: HeadExits,
): HeadWork[] {
  // A refused bound write is a foreign write landing first: say it, and offer reload.
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set());
  const conflict = (route: string, on: boolean) =>
    setConflicts((now) => {
      if (now.has(route) === on) return now;
      const next = new Set(now);
      if (on) next.add(route);
      else next.delete(route);
      return next;
    });
  const works = HEADED.map((one) => ({
    ...one,
    work: useRouteWork(one.spec, keyOf(one.manifest, address)),
  }));
  return works.flatMap(({ route, manifest, work, cells: heads }) => {
    const doc = work.doc as Doc | null;
    if (!doc) return [];
    const key = keyOf(manifest, address);
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
            ? { word: "apply", run: () => exits.planIn(route) }
            : { word: "open", run: () => exits.open(route) },
          open: (focus) => exits.open(route, head.focus === false ? undefined : focus),
          // A planned Work commits whole: all its cells are one head line (F-B-4).
          ...(plan ? { line: `${route}:${JSON.stringify(key)}` } : {}),
          ...(exits.planRefusal?.route === route ? { refusal: exits.planRefusal.message } : {}),
        },
      ];
    });
  });
}
