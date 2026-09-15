import { FileWorkspace, fileSearch, type FileObservation } from "#/settings/file-workspace";
import type { WorkKey, SettingsDocumentId } from "@pe/agent-contracts";
import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { useFamilyStore } from "#/family/store";
import { FamilyWorkspace } from "#/family/workspace";
import { manifest as familyManifest } from "#/family/manifest";
export const manifest = familyManifest;
import { routeSearch } from "#/route";

export const familySearch = (
  search: Record<string, unknown>,
): ReturnType<typeof routeSearch> & {
  mode?: "file";
  module?: string;
  root?: string;
  file?: string;
  thread?: string;
  demo?: string;
  capture?: boolean;
} => ({
  ...routeSearch(search),
  ...fileSearch(search),
  capture: search.capture === true || search.capture === "true" ? true : undefined,
  thread:
    typeof search.thread === "string" && search.thread.trim() ? search.thread.trim() : undefined,
  /** `?demo=<action>` mounts one seed of `manifest.seeds`; `?source=fixture` is gone. */
  demo: typeof search.demo === "string" && search.demo.trim() ? search.demo.trim() : undefined,
});

export const Route = createFileRoute("/family")({
  validateSearch: familySearch,
  component: FamilyRoute,
});

function FamilyRoute() {
  const search = Route.useSearch();
  return <FamilyRouteContent {...search} />;
}

export function FamilyRouteContent({
  capture,
  target,
  thread,
  ...initial
}: {
  capture?: boolean;
  target?: string;
  thread?: string;
} & Partial<ReturnType<typeof fileSearch>>) {
  // In the demo lane the SEED is the file: the picker and its host read stood between `?demo=`
  // and the seeded surface, so the route's own proof never reached its own actions (same cut as
  // `routes/settings.tsx`).
  if (new URLSearchParams(globalThis.location?.search ?? "").get("demo"))
    return (
      <FamilyPage
        fileKey={{ route: "family", target: null, work: "demo" }}
        selectFile={async () => {}}
        target={target}
        thread={thread}
        capture={capture}
      />
    );
  return (
    <FileWorkspace family initial={initial}>
      {(fileKey, selectFile, profile) => (
        <FamilyPage
          fileKey={fileKey}
          selectFile={selectFile}
          profile={profile}
          target={target}
          thread={thread}
          capture={capture}
        />
      )}
    </FileWorkspace>
  );
}

function FamilyPage({
  fileKey,
  selectFile,
  profile,
  target,
  thread,
  capture,
}: {
  fileKey: WorkKey;
  selectFile: (id: SettingsDocumentId) => Promise<void>;
  profile?: FileObservation;
  target?: string;
  thread?: string;
  capture?: boolean;
}) {
  const store = useFamilyStore({
    target,
    thread,
    fileKey,
    selectFile,
    profile: profile?.reading,
    refreshProfile: profile?.refresh,
  });
  const ready = store.ready != null;
  useEffect(() => {
    if (capture && ready) void store.actions.capture().catch(() => undefined);
  }, [capture, ready, store]);
  return <FamilyWorkspace store={store} />;
}
