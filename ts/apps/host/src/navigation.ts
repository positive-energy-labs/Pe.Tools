import { z } from "zod";
import {
  routeAddress,
  APP_ROUTES,
  addressSchema,
  documentRefSchema,
  harnessThreadSummarySchema,
  routeAt,
  sameAddress,
  targetsLabel,
  workKey,
  READING_MAX_FRAME_BYTES,
  type ThreadWorkSnapshot,
  type WorkResume,
  type NavigationSnapshot,
  type NavigationWork,
  type WorkKey,
} from "@pe/agent-contracts";
import type { RouteWorkspace } from "@pe/runtime";
import { sameDocumentRef, type ThreadWorkContext } from "./thread-work-context.ts";

const documentSchema = documentRefSchema.extend({ address: addressSchema.nullable() });
type NavigationDocument = z.infer<typeof documentSchema>;
export interface NavigationSources {
  threads(): Promise<unknown>;
  documents(): Promise<unknown>;
  routes?(): Promise<Record<string, string>>;
  contexts?(): readonly { threadId: string; context: ThreadWorkContext | null }[];
  subscribe?(notify: () => void): () => void;
}

/** Joins existing Work to remembered connections. No body read, carry-over, or native authority. */
export async function readThreadWork(
  workspace: RouteWorkspace,
  sources?: NavigationSources,
): Promise<ThreadWorkSnapshot> {
  const observations: string[] = [];
  const [workResult, contextResult, documentResult] = await Promise.allSettled([
    workspace.instances(),
    Promise.resolve().then(() => sources?.contexts?.() ?? null),
    sources ? sources.documents().then((value) => z.array(documentSchema).parse(value)) : null,
  ]);
  const census = workResult.status === "fulfilled" ? workResult.value : null;
  const contexts = contextResult.status === "fulfilled" ? contextResult.value : null;
  const documents = documentResult.status === "fulfilled" ? documentResult.value : null;
  if (!contexts) observations.push("Remembered thread connections are unavailable.");
  if (!census?.available) observations.push("Persisted Work discovery is unavailable.");
  if (census?.unindexed)
    observations.push(`${census.unindexed} older Work files have no discoverable identity.`);
  const unreadable =
    (census?.unreadable ?? 0) + (census?.works.filter((w) => w.state !== "ready").length ?? 0);
  if (unreadable)
    observations.push(
      `${unreadable} saved Work records could not be inspected; they were left unchanged.`,
    );
  if (!documents) observations.push("Current document availability is unknown.");
  if (contexts?.some(({ context }) => context === null))
    observations.push(
      "Some remembered thread connections could not be read; they were left unchanged.",
    );
  const snapshot: ThreadWorkSnapshot = {
    observedAt: new Date().toISOString(),
    observations,
    truncated: Boolean(census?.truncated || (contexts?.length ?? 0) > 200),
    threads: (contexts ?? []).slice(0, 200).map(({ threadId, context }) => ({
      threadId,
      documents: (context?.documents ?? []).map((doc) => ({
        id: doc.id,
        name: doc.name,
        availability:
          documents === null
            ? ("unknown" as const)
            : documents.some((open) =>
                  doc.address !== null
                    ? open.address !== null && sameAddress(doc.address, open.address)
                    : doc.refs.some((ref) => sameDocumentRef(ref, open)),
                )
              ? ("open" as const)
              : ("closed" as const),
      })),
      works: (census?.works ?? []).flatMap((work) => {
        if (work.state !== "ready" || work.unfinished === 0 || !context) return [];
        const scope = work.scope;
        const links = context.works.filter(({ key }) => workKey(key) === work.id);
        const matches = context.documents.filter(
          (doc) =>
            links.some((link) => link.documentId === doc.id) ||
            (scope.binding === "address"
              ? doc.address !== null && sameAddress(doc.address, scope.target)
              : scope.binding === "open"
                ? doc.refs.some((ref) => sameDocumentRef(ref, scope.open))
                : false),
        );
        const explicit = links.length > 0;
        if (!matches.length && !explicit) return [];
        return [
          {
            id: work.id,
            documentId: matches.length === 1 ? matches[0]!.id : null,
            route: work.route,
            intent: work.title,
            unfinished: work.unfinished,
          },
        ];
      }),
    })),
  };
  // The batch shares the normal Reading frame limit; an oversized row cannot blank every row.
  let remaining = READING_MAX_FRAME_BYTES - 8192;
  snapshot.threads = snapshot.threads.filter((thread) => {
    const bytes = Buffer.byteLength(JSON.stringify(thread));
    if (bytes > remaining) {
      snapshot.truncated = true;
      return false;
    }
    remaining -= bytes;
    return true;
  });
  if (snapshot.truncated)
    observations.push(
      "This is a bounded Work snapshot; additional stored items were not included.",
    );
  return snapshot;
}

/** Explicit Work navigation keeps its saved address even when native execution is unavailable. */
export async function resumeWork(
  workspace: RouteWorkspace,
  id: string,
  sources?: NavigationSources,
): Promise<WorkResume | null> {
  const census = await workspace.instances();
  if (!census.available) throw new Error("Persisted Work discovery is unavailable");
  const work = census.works.find((item) => item.id === id);
  if (!work) return null;
  const routes = (await sources?.routes?.()) ?? {};
  const path = routes[work.route] ?? documentRoutes[work.route];
  if (work.scope.binding === "workspace" && work.route === "schedules") {
    const addresses = (sources?.contexts?.() ?? []).flatMap(({ context }) =>
      context
        ? context.works
            .filter(({ key }) => workKey(key) === id)
            .flatMap(({ documentId }) =>
              context.documents
                .filter((doc) => doc.id === documentId && doc.address !== null)
                .map((doc) => doc.address!),
            )
        : [],
    );
    const unique = addresses.filter(
      (at, index) => addresses.findIndex((other) => sameAddress(other, at)) === index,
    );
    return {
      id,
      key: work.scope,
      url:
        unique.length === 1 && work.state === "ready"
          ? routeAddress("schedules").link({ workspaceId: work.scope.work }, { target: unique[0]! })
          : null,
      reason:
        unique.length === 1 && work.state === "ready"
          ? null
          : "This schedule Work has no unique remembered document binding. It was left unchanged.",
    };
  }
  if (work.scope.binding === "host" && !routes[work.route])
    return {
      id,
      key: work.scope,
      url: null,
      reason: "This tool requires a document; its host-only Work has no document binding.",
    };
  if (
    work.scope.binding === "workspace" &&
    !(routes[work.route] && work.scope.work === "calculator")
  )
    return {
      id,
      key: work.scope,
      url: null,
      reason: "This tool has no URL that resumes this named Work workspace.",
    };
  if (work.state !== "ready" || !path)
    return {
      id,
      key: work.scope,
      url: null,
      reason:
        work.state === "unreadable"
          ? "Saved Work is unreadable and was left unchanged."
          : "This Work's tool is not currently registered. The saved Work was left unchanged.",
    };
  const target =
    work.scope.binding === "address"
      ? work.scope.target
      : work.scope.binding === "open"
        ? JSON.stringify({ kind: "open", ref: work.scope.open })
        : undefined;
  const at = routeAt(path);
  const carry = { target, work: work.scope.binding === "workspace" ? work.scope.work : undefined };
  return {
    id,
    key: work.scope,
    url: at
      ? routeAddress(at).link({}, carry)
      : `${path}?${new URLSearchParams(Object.entries(carry).filter((entry): entry is [string, string] => entry[1] !== undefined))}`,
    reason: null,
  };
}

const documentRoutes: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  APP_ROUTES.filter((route) => route.resume === "document").map((route) => [route.key, route.path]),
);

function destination(
  scope: WorkKey,
  documents: readonly NavigationDocument[],
  available: boolean,
  routes: Record<string, string> = {},
) {
  // Pod routes own a document-free calculator workspace as well as document-bound Works.
  if (scope.binding === "workspace" && scope.work === "calculator" && routes[scope.route])
    return { url: routes[scope.route]!, reason: null };
  if (scope.binding === "workspace")
    return { url: null, reason: "This tool has no URL that resumes this named Work workspace." };
  const path = routes[scope.route] ?? documentRoutes[scope.route];
  if (!path)
    return { url: null, reason: "This Work has no document route that accepts its identity." };
  if (scope.binding === "host")
    if (routes[scope.route]) return { url: path, reason: null };
    else
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
  const target = JSON.stringify({ kind: "open", ref });
  const route = routeAt(path);
  return {
    url: route
      ? routeAddress(route).link({}, { target })
      : `${path}?${new URLSearchParams({ target })}`,
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
  const routes = (await sources?.routes?.()) ?? {};
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
      ? destination(work.scope, documents ?? [], documents !== null, routes)
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
      context: targetsLabel(thread.head.targets) ?? thread.providerName,
      state: thread.activity.state,
      revision: thread.head.revision,
      url: routeAddress("pea").link({}, { thread: thread.id }),
      reason: null,
    })),
    observations,
    truncated,
  };
}
