import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { createLiveFamiliesHost } from "#/families/host";
import { createFamiliesStore, type FamiliesStore } from "#/families/store";
import { FamiliesWorkspace } from "#/families/workspace";
import { registerInspectableAtomStore } from "#/state/atom-inspect";
import { appAtomRegistry } from "#/state/registry";
import { withThread } from "./-with-thread";

export const Route = createFileRoute("/families")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { target?: string; thread?: string } => ({
    target: typeof search.target === "string" ? search.target.trim() : "",
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  }),
  beforeLoad: withThread,
  component: FamiliesRoute,
});

const owners = new Map<
  string,
  { store: FamiliesStore; disposeTimer: ReturnType<typeof setTimeout> | null }
>();

function FamiliesRoute() {
  const { target = "", thread } = Route.useSearch();
  if (!thread) return null;
  return <FamiliesStoreOwner key={`${thread}:${target}`} thread={thread} target={target} />;
}

function FamiliesStoreOwner({ thread, target }: { thread: string; target: string }) {
  const navigate = useNavigate({ from: "/families" });
  const key = `${thread}:${target}`;
  let owner = owners.get(key);
  if (!owner) {
    const scope = { threadId: thread };
    owner = {
      store: createFamiliesStore({
        registry: appAtomRegistry,
        scope,
        host: createLiveFamiliesHost(scope),
        search: {
          target,
          patch: (patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }) }),
        },
      }),
      disposeTimer: null,
    };
    owners.set(key, owner);
  }
  const store = owner.store;
  useEffect(() => {
    void store.actions.bind(target).catch(() => undefined);
    const unregister = import.meta.env.DEV ? registerInspectableAtomStore(store) : undefined;
    if (owner.disposeTimer) clearTimeout(owner.disposeTimer);
    return () => {
      owner.disposeTimer = setTimeout(() => {
        store.dispose();
        owners.delete(key);
      }, 0);
      unregister?.();
    };
  }, [key, owner, store, target]);
  return <FamiliesWorkspace store={store} />;
}
