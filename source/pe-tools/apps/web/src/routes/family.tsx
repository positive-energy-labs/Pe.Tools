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
 *     passes it to the family store to address both route-state slices to that conversation.
 *     Declared here because an undeclared param is dropped on the first navigation.
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

import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { appAtomRegistry } from "#/state/registry";
import { withThread } from "./-with-thread";
import { useRouteStore } from "#/state/use-route-store";

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
  beforeLoad: withThread,
  component: FamilyRoute,
});

function FamilyRoute() {
  const search = Route.useSearch();
  const { family, thread, target = "", profile = "" } = search;
  if (!thread) return null;
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
  const store = useRouteStore(() => {
    const scope = { threadId: thread };
    return createFamilyStore({
      registry: appAtomRegistry,
      scope,
      host: createLiveFamilyHost(scope),
      search: {
        target,
        patch: (patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }) }),
      },
    });
  });
  const snapshot = useAtomValue(store.atoms.snapshot);
  const openProfile = snapshot?.documentId.relativePath ?? "";
  const successfulOpen = useRef<{ requested: string; before: string } | null>(null);
  useEffect(() => {
    const before = store.registry.get(store.atoms.snapshot)?.documentId.relativePath ?? "";
    if (!profile || before === profile) {
      successfulOpen.current = null;
      return;
    }
    successfulOpen.current = null;
    let current = true;
    void store.actions
      .open(profile)
      .then(() => {
        if (!current) return;
        successfulOpen.current = { requested: profile, before };
        const opened = store.registry.get(store.atoms.snapshot)?.documentId.relativePath;
        if (opened && opened !== before && opened !== profile) {
          successfulOpen.current = null;
          void navigate({ search: (previous) => ({ ...previous, profile: opened }) });
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [navigate, profile, store]);
  useEffect(() => {
    const opened = successfulOpen.current;
    if (
      !openProfile ||
      opened?.requested !== profile ||
      openProfile === opened.before ||
      openProfile === profile
    )
      return;
    successfulOpen.current = null;
    void navigate({ search: (previous) => ({ ...previous, profile: openProfile }) });
  }, [navigate, openProfile, profile]);
  return <FamilyWorkspace store={store} requestedFamily={family} />;
}
