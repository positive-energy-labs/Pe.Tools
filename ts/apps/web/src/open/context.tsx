import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
  type ComponentType,
} from "react";
import type { OpenPageState } from "./page";
import type { ReadingState } from "../shell/source-contract";
export interface OpenOutcome { state: string; outcome?: { state: string }; receipt?: { key: string }; refusal?: { message: string } }
export interface OpenOwner {
  subscribe(listener: () => void): () => void;
  version(): number;
  busy(): unknown | null;
  fixture: { name: string } | null;
  view: { read(): { page: OpenPageState }; setPage(patch: Partial<OpenPageState>): unknown };
  readings: { get(id: string): ReadingState; mount(ids: readonly string[]): () => void };
  control(id: string, input?: unknown): { refusal: string | null; label: string; run(): Promise<OpenOutcome> };
}
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
export function outcomeOf(result: OpenOutcome) {
  if (result.state === "done" && result.receipt)
    return { kind: "receipt" as const, label: `${result.receipt.key} ${result.outcome?.state ?? result.state}` };
  if (result.refusal) return { kind: "refused" as const, label: result.refusal.message };
  return { kind: "advisory" as const, label: result.outcome?.state ?? result.state };
}
