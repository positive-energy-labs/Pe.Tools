import type { ReactNode } from "react";
import { useFamilyStore, type FamilyMount } from "./store";
import { FamilyWorkspaceProvider } from "./workspace-context";
import { useFamilyWorkspaceCore } from "./workspace-core";
import { useFamilyColumns } from "./workspace-columns";
import type { FamilyContext } from "./route";

type Cells = Pick<FamilyContext["cells"], "at">;
function useFamilyWorkspaceModel(owner: FamilyMount, cells: Cells, value?: FamilyContext["value"]) {
  const store = useFamilyStore(owner, value);
  const core = useFamilyWorkspaceCore(store, cells, value);
  const columns = useFamilyColumns(core);
  return { ...core, ...columns, picker: store.picker };
}
export type FamilyWorkspaceModel = ReturnType<typeof useFamilyWorkspaceModel>;
export function FamilyProvider({
  owner,
  cells,
  value,
  children,
}: {
  owner: FamilyMount;
  cells: Cells;
  value?: FamilyContext["value"];
  children: ReactNode;
}) {
  const model = useFamilyWorkspaceModel(owner, cells, value);
  return <FamilyWorkspaceProvider value={model}>{children}</FamilyWorkspaceProvider>;
}
