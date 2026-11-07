import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
  type ComponentType,
} from "react";
import type { GraphMount } from "../shell/mount";
import type { OpenPageState } from "./graph";
import type { VerbCompletion } from "../shell/verbs";
export type OpenOwner = GraphMount<OpenPageState, unknown>;
export const OpenOwnerContext = createContext<OpenOwner | null>(null);
let controls: ComponentType<{children:ReactNode}> | null = null;
/** App composition supplies the companion control owner; drawings only consume its context. */
export function installOpenControls(component:ComponentType<{children:ReactNode}>) { controls=component; }
export function OpenControlScope({children}:{children:ReactNode}) {
  const owner=useContext(OpenOwnerContext);
  if(owner) return children;
  const Controls=controls;
  if(!Controls) throw Error("Open controls are not installed");
  return <Controls>{children}</Controls>;
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
