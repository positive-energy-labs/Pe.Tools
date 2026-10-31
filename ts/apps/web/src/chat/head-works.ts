/**
 * The Works the Chat head summarizes: every plugin route's Work, read by the key its graph
 * declares, through the kernel's cross-Work handles, one head Work per declared
 * cell head with pending cells. Every exit opens that route in the plugin pane.
 */
import { useState, useSyncExternalStore, useMemo } from "react";
import {
  bindWork,
  workKey,
  type Address,
  type DocumentRef,
  type CellLike,
  type WorkKey,
  type RouteGraph,
  type CellsDecl,
} from "@pe/agent-contracts";

import { useWorkHandles } from "#/shell/use-work-handles";
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
type Manifest = RouteGraph<any, Doc>;

const keyOf = (
  manifest: Manifest,
  address: Address | null,
  document: DocumentRef | null,
): WorkKey | null =>
  address || document ? bindWork(manifest.key, address, undefined, document ?? undefined) : null;

const pending = (cell: CellLike | undefined) =>
  cell != null && (cell.suggestion != null || cell.edit != null);

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
      publicRoutes.entries().flatMap(({ graph: manifest }) => {
        return manifest?.needs && manifest.work && manifest.cells?.length
          ? [
              {
                route: manifest.key,
                manifest,
                graph: manifest,
                cells: manifest.cells,
                key: keyOf(manifest, address, document),
                closed: document === null,
              },
            ]
          : [];
      }),
    [revision, address, document?.session, document?.openId],
  );
  const summaries = useWorkHandles(headed);
  const [openRefusal, setOpenRefusal] = useState<{ route: string; message: string } | null>(null);
  const works = headed.map((one, index) => ({ ...one, work: summaries[index]! }));
  return works.flatMap(({ route, manifest, work, cells: heads }) => {
    const doc = work.doc as Doc | null;
    const key = keyOf(manifest, address, document);
    if (!doc || !key || !publicRoutes.get(route)) return [];
    const place = capturedPlace(route, key, doc, undefined, false);
    // A review names a cell: the route's own page fields for it land on its place; a route that
    // declares none opens as before.
    const open = (plan: boolean, at?: Record<string, string>) => {
      if (!place.ok) {
        setOpenRefusal({ route, message: place.refusal });
        return;
      }
      setOpenRefusal(null);
      if (plan) exits.planIn(place);
      else
        exits.open(at ? { ...place, page: { ...place.page, ...at } as typeof place.page } : place);
    };
    return heads.flatMap((head: CellsDecl<Doc>): HeadWork[] => {
      const cells = (
        head.segment === null ? { [head.key!]: doc[head.key!] } : (doc[head.segment] ?? {})
      ) as Record<string, CellLike | undefined>;
      const unaccepted = work.pending.filter(({ patches }) =>
        patches.some(({ path }) => !path.length || path[0] === (head.segment ?? head.key)),
      );
      if (!Object.values(cells).some(pending) && !unaccepted.length) return [];
      const plan = head.commit === "plan";
      return [
        {
          id: `${workKey(key)}:${head.segment ?? head.key}`,
          route: chatPluginTitle(route),
          subject: head.noun ?? subject,
          cells: cells as Record<string, CellLike>,
          wire: {
            segment: head.segment,
            revision: work.revision,
            write: work.write,
            pending: (press) => work.pending.some((request) => request.press === press),
            discard: work.discard,
          },
          groupOf: head.groupOf,
          ...(head.label ? { label: head.label } : {}),
          ...(head.show ? { show: head.show } : {}),
          stale: work.stale,
          conflict: work.conflict,
          reload: work.reload,
          pending: unaccepted.flatMap(({ press }) =>
            press
              ? [
                  {
                    press,
                    retry: () => work.retry(press),
                    discard: () => work.discard(press),
                  },
                ]
              : [],
          ),
          commit: plan
            ? { word: "apply", run: () => open(true) }
            : { word: "open", run: () => open(false) },
          open: (cell) => open(false, cell && head.focus ? head.focus(cell) : undefined),
          // A planned Work commits whole: all its cells are one head line (F-B-4).
          ...(plan ? { line: workKey(key) } : {}),
          ...(exits.planRefusal?.route === route ? { refusal: exits.planRefusal.message } : {}),
          ...(!place.ok ? { refusal: place.refusal } : {}),
          ...(openRefusal?.route === route ? { refusal: openRefusal.message } : {}),
        },
      ];
    });
  });
}
