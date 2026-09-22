import { createContext, useContext, type ReactNode } from "react";

import type { AtlasModel } from "#/takeoff/atlas";

const AtlasContext = createContext<AtlasModel | null>(null);

export function AtlasProvider({ value, children }: { value: AtlasModel; children: ReactNode }) {
  return <AtlasContext.Provider value={value}>{children}</AtlasContext.Provider>;
}

export function useAtlasWorkspace() {
  const value = useContext(AtlasContext);
  if (value == null) throw new Error("AtlasProvider is missing");
  return value;
}
