import {createContext, use} from "react";
import type {PodRouteDescriptor} from "@pe/agent-contracts";
export type Inventory = {
  rows: PodRouteDescriptor[];
  errors: Readonly<Record<string, string>>;
  loading: boolean;
  trust: (row: PodRouteDescriptor, trusted: boolean) => Promise<void>;
};
export const PodRoutesContext = createContext<Inventory | null>(null);
export function usePodRoutes() {
  return use(PodRoutesContext);
}

