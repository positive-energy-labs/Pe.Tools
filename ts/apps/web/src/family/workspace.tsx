import type { ReactNode } from "react";
import { useFamilyStore, type FamilyMount } from "./store";
import { FamilyWorkspaceProvider } from "./workspace-context";
import { useFamilyWorkspaceCore } from "./workspace-core";
import { useFamilyColumns } from "./workspace-columns";

function useFamilyWorkspaceModel(owner: FamilyMount) {
  const store = useFamilyStore(owner);
  const core = useFamilyWorkspaceCore(store);
  const columns = useFamilyColumns(core);
  return { ...core, ...columns, picker: store.picker };
}
export type FamilyWorkspaceModel = ReturnType<typeof useFamilyWorkspaceModel>;
export function FamilyProvider({ owner, children }: { owner: FamilyMount; children: ReactNode }) {
  const value = useFamilyWorkspaceModel(owner);
  return <FamilyWorkspaceProvider value={value}>{children}</FamilyWorkspaceProvider>;
}
