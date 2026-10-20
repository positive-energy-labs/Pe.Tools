import { useMemo } from "react";
import { useRouteViewBridge } from "#/route/view-bridge";

type Snapshot = {
  groups: readonly { id: string; systemNames: readonly string[] }[];
  levels: readonly { id: number | string; name: string }[];
};

/**
 * What the Ducts page tells Pea it shows: the subject keys it may set (`routeViews.ducts`), and the
 * group and level ids the page can take, so a person's system name resolves to a group id.
 */
export function useDuctsViewBridge({
  thread,
  surface,
  page,
  setPage,
  snapshot,
  document,
}: {
  thread?: string;
  surface: "chat" | "route";
  page: { group: string; level: string; selected: string };
  setPage: (patch: { group?: string; level?: string; selected?: string; issue?: string }) => void;
  snapshot: Snapshot | null;
  document: unknown;
}) {
  const facts = useMemo(
    () => ({
      groups: (snapshot?.groups ?? []).slice(0, 500).map((group) => ({
        id: group.id,
        systemNames: group.systemNames.slice(0, 8),
      })),
      levels: (snapshot?.levels ?? []).map((level) => ({ id: String(level.id), name: level.name })),
    }),
    [snapshot],
  );
  useRouteViewBridge({
    route: "ducts",
    thread,
    surface,
    visible: true,
    page: { group: page.group, level: page.level, selected: page.selected },
    // Choosing a group by hand clears the selection and issue; Pea's patch does the same.
    apply: (patch) =>
      setPage({
        ...patch,
        ...("group" in patch && !("selected" in patch) ? { selected: "" } : {}),
        ...("group" in patch || "selected" in patch ? { issue: "" } : {}),
      }),
    context: { document },
    facts,
  });
}
