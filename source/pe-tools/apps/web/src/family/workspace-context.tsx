import { createContext, useContext, type ReactNode } from "react";

import type { FamilyWorkspaceModel } from "#/family/workspace";

const FamilyWorkspaceContext = createContext<FamilyWorkspaceModel | null>(null);

export function FamilyWorkspaceProvider({
  value,
  children,
}: {
  value: FamilyWorkspaceModel;
  children: ReactNode;
}) {
  return (
    <FamilyWorkspaceContext.Provider value={value}>{children}</FamilyWorkspaceContext.Provider>
  );
}

export function useFamilyWorkspace() {
  const value = useContext(FamilyWorkspaceContext);
  if (value == null) throw new Error("FamilyWorkspaceProvider is missing");
  return value;
}
