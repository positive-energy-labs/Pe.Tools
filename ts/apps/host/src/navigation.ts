import { z } from "zod";
import {
  APP_ROUTES,
  addressSchema,
  documentRefSchema,
  harnessThreadSummarySchema,
  sameAddress,
  type NavigationSnapshot,
  type NavigationWork,
  type WorkKey,
} from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";

const documentSchema = documentRefSchema.extend({ address: addressSchema.nullable() });
type NavigationDocument = z.infer<typeof documentSchema>;
export interface NavigationSources {
  threads(): Promise<unknown>;
  documents(): Promise<unknown>;
}

const documentRoutes: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  APP_ROUTES.filter((route) => route.resume === "document").map((route) => [route.key, route.path]),
);

function destination(scope: WorkKey, documents: readonly NavigationDocument[], available: boolean) {
  // No route mounts a named Work workspace: /open holds no staged Work, and /takeoffs?work names a
  // capture, not generic Work.
  if (scope.binding === "workspace")
    return { url: null, reason: "This tool has no URL that resumes this named Work workspace." };
  const path = documentRoutes[scope.route];
  if (!path)
    return { url: null, reason: "This Work has no document route that accepts its identity." };
  if (scope.binding === "host")
    return {
      url: null,
      reason: "This route requires a document; its host-only Work has no document binding.",
    };
  if (!available) return { url: null, reason: "Current document bindings are unavailable." };
  const matching = documents.filter((document) =>
    scope.binding === "open"
      ? document.session === scope.open.session &&
        document.openId === scope.open.openId &&
        document.address === null
      : document.address !== null && sameAddress(document.address, scope.target),
  );
  if (matching.length !== 1)
    return {
      url: null,
      reason:
        matching.length > 1
          ? "This address has multiple current document bindings."
          : "The Work is saved, but its document is not currently available. Open that document to resume.",
    };
  const ref = { session: matching[0]!.session, openId: matching[0]!.openId };
  return {
    url: `${path}?${new URLSearchParams({ target: JSON.stringify({ kind: "open", ref }) })}`,
    reason: null,
  };
}

const context = (scope: WorkKey) =>
  scope.binding === "address"
    ? scope.target
    : scope.binding === "open"
      ? `${scope.open.session} / ${scope.open.openId}`
      : scope.binding === "workspace"
        ? scope.work
        : "Host workspace";

/** Projects the canonical store and existing harness summaries. No Work read may create or migrate state. */
export async function readNavigation(
  workspace: RouteWorkspace,
  sources?: NavigationSources,
): Promise<NavigationSnapshot> {
  const observations: string[] = [];
  const [workResult, threadResult, documentResult] = await Promise.allSettled([
    workspace.instances(),
    sources
      ? sources.threads().then((value) => z.array(harnessThreadSummarySchema).parse(value))
      : Promise.resolve(null),
    sources
      ? sources.documents().then((value) => z.array(documentSchema).parse(value))
      : Promise.resolve(null),
  ]);
  const census = workResult.status === "fulfilled" ? workResult.value : null;
  const threads = threadResult.status === "fulfilled" ? threadResult.value : null;
  const documents = documentResult.status === "fulfilled" ? documentResult.value : null;
  if (!census || !census.available) observations.push("Persisted Work discovery is unavailable.");
  if (census?.unindexed)
    observations.push(
      `${census.unindexed} legacy hash-only files have no discoverable Work identity; exact-key reads remain available.`,
    );
  if (census?.unreadable)
    observations.push(
      `${census.unreadable} stored files could not be read or verified; they were left unchanged.`,
    );
  if (!threads) observations.push("Pea thread summaries are unavailable.");
  if (!documents)
    observations.push(
      "Current document bindings are unavailable; document resume links are refused.",
    );
  const works: NavigationWork[] = (census?.works ?? []).slice(0, 200).map((work) => ({
    id: work.id,
    route: work.route,
    label: work.title.slice(0, 300),
    context: context(work.scope),
    state: work.state,
    revision: work.revision,
    proposals: work.proposals,
    ...(work.state === "ready"
      ? destination(work.scope, documents ?? [], documents !== null)
      : {
          url: null,
          reason:
            work.state === "unreadable"
              ? "Saved Work is unreadable. It was left unchanged."
              : "This Work's tool is not registered.",
        }),
  }));
  const truncated = Boolean(
    census?.truncated || (census?.works.length ?? 0) > 200 || (threads?.length ?? 0) > 200,
  );
  if (truncated)
    observations.push(
      "Navigation is a bounded snapshot; additional stored items were not included.",
    );
  return {
    observedAt: new Date().toISOString(),
    works,
    threads: (threads ?? []).slice(0, 200).map((thread) => ({
      id: thread.id,
      route: "chat",
      label: thread.title.slice(0, 300),
      context: thread.head.displayLabel ?? thread.providerName,
      state: thread.activity.state,
      revision: thread.head.revision,
      url: `/pea?${new URLSearchParams({ thread: thread.id })}`,
      reason: null,
    })),
    observations,
    truncated,
  };
}
