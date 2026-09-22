import { createContext, useContext, type ReactNode } from "react";

import type { FamiliesWorkspaceModel } from "#/families/workspace";

const FamiliesWorkspaceContext = createContext<FamiliesWorkspaceModel | null>(null);

export function FamiliesWorkspaceProvider({
  value,
  children,
}: {
  value: FamiliesWorkspaceModel;
  children: ReactNode;
}) {
  return (
    <FamiliesWorkspaceContext.Provider value={value}>{children}</FamiliesWorkspaceContext.Provider>
  );
}

export function useFamiliesWorkspace() {
  const value = useContext(FamiliesWorkspaceContext);
  if (value == null) throw new Error("FamiliesWorkspaceProvider is missing");
  return value;
}
