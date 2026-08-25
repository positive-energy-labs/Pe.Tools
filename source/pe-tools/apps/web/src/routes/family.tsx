/**
 * /family — the route shell. Everything the surface IS lives in `#/family/workspace`.
 *
 * PROMOTED 2026-08-16. This route used to carry a two-lane workspace (an authored `family.json`
 * bound through route:settings, and the family open in Revit's family editor through
 * family.editor.snapshot/apply) plus the `?variant=` gate that mounted the clean-room rebuilds
 * beside it. The clean room ruled: variant e IS the product, so it stopped being a variant and
 * became the route. The rivals are on snapshot branch `proto/family-variants-2026-08`; the
 * superseded two-lane surface and its twelve modules are in git at `0af4260`.
 *
 * WHAT THE ROUTE STILL OWNS, and why each survived the promotion:
 *   `thread` — the chat side pane iframes this route with a thread id, and `#/workbench/route-state`
 *     reads it straight off the URL to scope route state to that conversation. Declared here
 *     because an undeclared param is dropped on the first navigation, and the pane would then
 *     silently fall back to workspace scope. Nothing on the page reads it; the router does.
 *   `family` — `/families` row navigation passes an ELEMENT id. Phase B gave the surface a real
 *     document lane, but a placed element is still not a document: nothing maps an element id to a
 *     `family.json` path. So it is handed to the workspace and SAID rather than swallowed — the
 *     header renders an advisory pointing at the sentence's document slot, which is where you pick.
 *
 * WHAT WENT: `?mock`, because the lane is decided by whether a family document is OPEN — a flag
 * that chose the lane would be able to contradict the page's own state; `?variant`, because there
 * is nothing to switch to.
 */
import { useEffect, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { EmptyState } from "#/components/lang/empty";
import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore, type FamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { registerInspectableAtomStore } from "#/state/atom-inspect";
import { appAtomRegistry } from "#/state/registry";

export const Route = createFileRoute("/family")({
  /** Every param is optional, so every `<Link to="/family">` stays search-free. */
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    family?: string;
    thread?: string;
    target?: string;
    profile?: string;
    stage?: "author" | "evidence";
  } => ({
    family:
      typeof search.family === "string" && search.family.trim() ? search.family.trim() : undefined,
    thread:
      typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
    target: typeof search.target === "string" ? search.target.trim() : "",
    profile: typeof search.profile === "string" ? search.profile.trim() : "",
    stage: search.stage === "evidence" ? "evidence" : "author",
  }),
  component: FamilyRoute,
});

function FamilyRoute() {
  const search = Route.useSearch();
  const { family, thread, target = "", profile = "" } = search;
  if (!thread)
    return <EmptyState story="scope" exit="open this page from a chat thread">no family workspace is open</EmptyState>;
  return (
    <FamilyStoreOwner
      key={`${thread}:${target}`}
      thread={thread}
      target={target}
      profile={profile}
      family={family}
    />
  );
}

function FamilyStoreOwner({
  thread,
  target,
  profile,
  family,
}: {
  thread: string;
  target: string;
  profile: string;
  family?: string;
}) {
  const navigate = useNavigate({ from: "/family" });
  const storeRef = useRef<FamilyStore | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!storeRef.current) {
    const scope = { threadId: thread };
    storeRef.current = createFamilyStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamilyHost(scope),
      search: {
        target,
        patch: (patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }) }),
      },
    });
  }
  const store = storeRef.current;
  const snapshot = useAtomValue(store.atoms.snapshot);
  const openProfile = snapshot?.documentId.relativePath ?? "";
  useEffect(() => {
    if (!profile || store.registry.get(store.atoms.snapshot)?.documentId.relativePath === profile)
      return;
    void store.actions.open(profile).catch(() => undefined);
  }, [profile, store]);
  useEffect(() => {
    if (!openProfile) return;
    void navigate({ search: (previous) => ({ ...previous, profile: openProfile }) });
  }, [navigate, openProfile]);
  useEffect(() => {
    const unregister = import.meta.env.DEV ? registerInspectableAtomStore(store) : undefined;
    if (disposeTimer.current) clearTimeout(disposeTimer.current);
    return () => {
      disposeTimer.current = setTimeout(() => store.dispose(), 0);
      unregister?.();
    };
  }, [store]);
  return <FamilyWorkspace store={store} requestedFamily={family} />;
}
