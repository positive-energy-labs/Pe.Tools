import {
  createContext,
  useContext,
  useSyncExternalStore,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import type { GraphMount } from "../shell/mount";
import type { OpenPageState } from "./graph";
import type { VerbCompletion } from "../shell/verbs";
export type OpenOwner = GraphMount<OpenPageState, unknown>;
export const OpenOwnerContext = createContext<OpenOwner | null>(null);
const Fallback = lazy(() =>
  import("./kernel").then((module) => ({ default: module.OpenControls })),
);
export function OpenControlScope({ children }: { children: ReactNode }) {
  return useContext(OpenOwnerContext) ? (
    children
  ) : (
    <Suspense fallback="Reading document controls">
      <Fallback>{children}</Fallback>
    </Suspense>
  );
}
export function useOpenOwner() {
  const owner = useContext(OpenOwnerContext);
  if (!owner) throw Error("Open controls need a scope");
  useSyncExternalStore(owner.subscribe, owner.version, owner.version);
  return owner;
}
export const useOpenKernel = useOpenOwner;
export function outcomeOf(result: VerbCompletion) {
  if (result.state === "done" && "receipt" in result)
    return { kind: "receipt" as const, label: `${result.receipt.key} ${result.outcome.state}` };
  if ("refusal" in result) return { kind: "refused" as const, label: result.refusal.message };
  return { kind: "advisory" as const, label: result.outcome.state };
}
