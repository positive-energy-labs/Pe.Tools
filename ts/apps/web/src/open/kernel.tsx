import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useGraphRoute, type GraphMount, type RouteAdapters } from "#/shell/mount";
import type { InvocationResult } from "#/shell/verbs";
import { openGraph, type OpenPageState } from "./graph";
import { openSources } from "./sources";
export type OpenOwner = GraphMount<OpenPageState, unknown>;
export const OpenOwnerContext = createContext<OpenOwner | null>(null);
export const openControlAdapters: RouteAdapters<OpenPageState, unknown> = {
  sources: openSources(),
  bodies: {},
  binding: (id, row, scope) => {
    if (id === "refresh") return { subject: null, args: {} };
    const input = row as { request?: unknown; refusal?: string | null } | undefined;
    const machine = scope.readings.machine;
    const refusal =
      scope.page.demo && !scope.page.live
        ? "Frozen demos do not change Revit"
        : machine?.status !== "absent" && !machine?.current
          ? "Refresh the machine reading before changing Revit"
          : (input?.refusal ?? null);
    return { subject: null, args: { ...input, refusal } };
  },
  verbDepends: Object.fromEntries(
    ["open", "start", "stop", "restart", "close"].map((id) => [id, ["machine"]]),
  ),
};
/** The composer and machine drawer use the same kernel verbs without a standalone route. */
export function OpenControls({ children }: { children: ReactNode }) {
  const { owner } = useGraphRoute(openGraph, openControlAdapters, { url: false });
  return <OpenOwnerContext value={owner}>{children}</OpenOwnerContext>;
}
export function OpenControlScope({ children }: { children: ReactNode }) {
  const owner = useContext(OpenOwnerContext);
  return owner ? children : <OpenControls>{children}</OpenControls>;
}
export function useOpenKernel() {
  const inherited = useContext(OpenOwnerContext);
  const { owner } = useGraphRoute(openGraph, openControlAdapters, { url: false });
  const selected = inherited ?? owner;
  useSyncExternalStore(selected.subscribe, selected.version, selected.version);
  return selected;
}
export function useOpenOwner() {
  const owner = useContext(OpenOwnerContext);
  if (!owner) throw Error("Open controls must mount through OpenControlScope");
  useSyncExternalStore(owner.subscribe, owner.version, owner.version);
  return owner;
}
export function outcomeOf(result: InvocationResult) {
  if (result.state === "done" && "receipt" in result)
    return { kind: "receipt" as const, label: `${result.receipt.key} ${result.receipt.state}` };
  if ("refusal" in result) return { kind: "refused" as const, label: result.refusal.message };
  return { kind: "advisory" as const, label: result.state };
}
