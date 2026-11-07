import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { useGraphRoute, type GraphMount, type RouteAdapters } from "#/shell/mount";
import type { VerbCompletion } from "#/shell/verbs";
import { openControls as openGraph, type OpenPageState } from "./graph";
import { openSources } from "./sources";
import {OpenOwnerContext} from "./context";
export {OpenOwnerContext,OpenControlScope,useOpenKernel,useOpenOwner,outcomeOf} from "./context";
export const openControlAdapters: RouteAdapters<OpenPageState, unknown> = {
  sources: openSources(),
  bodies: {},
  binding: (id, row, scope) => {
    if (id === "refresh") return { subject: null, args: {} };
    const input = row as { request?: unknown; refusal?: string | null } | undefined;
    const machine = scope.readings.machine;
    const refusal =
      machine?.status !== "absent" && !machine?.current
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
