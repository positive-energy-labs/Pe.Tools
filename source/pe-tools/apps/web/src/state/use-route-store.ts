import { useEffect, useRef } from "react";
import type * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

export function useRouteStore<T extends { dispose(): void; registry: AtomRegistry.AtomRegistry }>(create: () => T): T {
  const storeRef = useRef<T | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  storeRef.current ??= create();
  const store = storeRef.current;
  useEffect(() => {
    if (disposeTimer.current) clearTimeout(disposeTimer.current);
    return () => {
      disposeTimer.current = setTimeout(() => store.dispose(), 0);
    };
  }, [store]);
  return store;
}
