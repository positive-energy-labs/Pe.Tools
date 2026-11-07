import type { ReactNode } from "react";
import { useFamilyStore } from "./store";
import { FamilyWorkspaceProvider } from "./workspace-context";
import { useFamilyWorkspaceCore } from "./workspace-core";
import { useFamilyColumns } from "./workspace-columns";
import type { FamilyContext } from "./route";

function useFamilyWorkspaceModel(ctx:FamilyContext) {
  const store=useFamilyStore(ctx);
  const core=useFamilyWorkspaceCore(store,ctx.cells,ctx.value);
  const columns=useFamilyColumns(core);
  return {...core,...columns,picker:store.picker};
}
export type FamilyWorkspaceModel=ReturnType<typeof useFamilyWorkspaceModel>;
export function FamilyProvider({ctx,children}:{ctx:FamilyContext;children:ReactNode}) {
  const model=useFamilyWorkspaceModel(ctx);
  return <FamilyWorkspaceProvider value={model}>{children}</FamilyWorkspaceProvider>;
}
