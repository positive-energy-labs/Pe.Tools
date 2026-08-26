import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { createLiveFamilyHost } from "#/family/host";
import { createFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { ThreadEmpty } from "#/components/thread-palette";
import { appAtomRegistry } from "#/state/registry";
import { withThread } from "./-with-thread";
import { useRouteStore } from "#/state/use-route-store";

export const Route = createFileRoute("/family")({
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
  if (!thread) return <ThreadEmpty />;
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
        profile,
        patch: (patch) => void navigate({ search: (previous) => ({ ...previous, ...patch }) }),
      },
    });
  });
  return <FamilyWorkspace store={store} requestedFamily={family} />;
}
