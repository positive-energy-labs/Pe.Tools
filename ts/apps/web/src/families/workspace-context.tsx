import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

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

/** The last cell a Work chip asked for: a serial, so pressing the same chip again re-lands. */
type Located = { key: string; n: number } | null;

export function createLocator() {
  let located: Located = null;
  const listeners = new Set<() => void>();
  return {
    locate: (key: string) => {
      located = { key, n: (located?.n ?? 0) + 1 };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read: () => located,
  };
}

export const useLocated = (locator: ReturnType<typeof createLocator>) =>
  useSyncExternalStore(locator.subscribe, locator.read, locator.read);
