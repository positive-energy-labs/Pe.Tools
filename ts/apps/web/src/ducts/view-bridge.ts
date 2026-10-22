import { useCallback, useMemo, useRef, useState } from "react";
import { viewportCodec, type OrbitViewport } from "@pe/agent-contracts";
import { systemsOf } from "@pe/ducts-domain/system-scope";
import { useRouteViewBridge } from "#/route/view-bridge";
import type { PageMove } from "#/route/manifest";
import type { DuctsPage, LoadedDuctsReading } from "./manifest";

/**
 * What the Ducts page tells Pea it shows: its address (`routeAddress("ducts")`), and the system
 * names and levels the page can take, so a person's word resolves to a system the page
 * knows; the picture's layer names; and the committed orbit pose the model picture reports (the
 * fit resolved from bounds when the viewport key is null), so a named look turns that pose. The
 * subject is a Revit system; group ids never reach Pea.
 */
export function useDuctsViewBridge({
  thread,
  surface,
  page,
  setPage,
  document,
  reading,
  membersReady,
}: {
  thread?: string;
  surface: "chat" | "route";
  page: DuctsPage;
  setPage: (patch: Partial<DuctsPage>, move?: PageMove<DuctsPage>) => void;
  document: unknown;
  reading: LoadedDuctsReading | null;
  membersReady: boolean;
}) {
  const scope = useMemo(
    () => ({ reading, system: page.system, viewport: page.viewport }),
    [reading, page.system, page.viewport],
  );
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [reported, setReported] = useState<{
    scope: typeof scope;
    pose: OrbitViewport | null;
  } | null>(null);
  const onPose = useCallback(
    (pose: OrbitViewport | null) => {
      // A late Canvas effect must not describe a newer reading, subject or viewport.
      if (currentScope.current !== scope) return;
      setReported((prior) =>
        prior?.scope === scope && JSON.stringify(prior.pose) === JSON.stringify(pose)
          ? prior
          : { scope, pose },
      );
    },
    [scope],
  );
  const pose =
    page.viewport?.kind === "orbit"
      ? page.viewport
      : reported?.scope === scope
        ? reported.pose
        : null;
  const snapshot = reading?.snapshot ?? null;
  // A new displayed snapshot (even of the same document) invalidates pending intents.
  const observation = useMemo(() => (reading ? crypto.randomUUID() : null), [reading]);
  const facts = useMemo(
    () => ({
      systems: (snapshot ? systemsOf(snapshot) : []).slice(0, 800).map((system) => ({
        name: system.name,
        classification: system.classification,
        units: system.units.slice(0, 8),
        networks: system.groups.length,
      })),
      levels: (snapshot?.levels ?? []).map((level) => ({ id: String(level.id), name: level.name })),
      ...(pose ? { pose: viewportCodec.encode(pose) } : {}),
    }),
    [snapshot, pose],
  );
  useRouteViewBridge({
    route: "ducts",
    thread,
    surface,
    visible: reading !== null && membersReady,
    page,
    // A Pea patch is one navigation; the manifest's `transition` couples system, selection and viewport.
    apply: (patch) => setPage(patch, { history: "push" }),
    context: { document, observation },
    facts,
  });
  return onPose;
}
