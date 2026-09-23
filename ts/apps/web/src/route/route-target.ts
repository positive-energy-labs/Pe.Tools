/** Where a route acts: its Target resolved from the thread head or a `?target` pin. */
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";
import { useMemo, useRef } from "react";
import {
  addressSchema,
  documentRequestSchema,
  resolveCallTarget,
  sameAddress,
  threadHeadSchema,
  type Address,
  type DocumentRequest,
  type ExecutionTarget,
  type Reading,
  type ReadingRequest,
  type TargetResolution,
} from "@pe/agent-contracts";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { readingAtom, peReadings, inventoryOf, previousOf, targetInventory } from "#/readings";
import { type RouteManifest } from "./manifest";
import { useThreadScope } from "#/chat/scope";
import { useOwned } from "./route-owner";

export interface BindingLost {
  readonly ref: { readonly session: string; readonly openId: string };
  readonly title: string | null;
  readonly sentence: string;
  readonly reason: "document-closed" | "session-gone";
  readonly reopened: { readonly openId: string; readonly title: string } | null;
}

/** The inventory's open documents, keyed `session/openId`, with their titles. */
const openTitles = (inventory: Reading<unknown>) => {
  const observed = previousOf(inventory) as
    | { sessions?: readonly BridgeSessionListEntry[] }
    | undefined;
  return new Map(
    inventoryOf(observed?.sessions ?? []).flatMap((session) =>
      (session.openDocuments ?? []).map(
        (doc) => [`${session.sessionId}/${doc.openId}`, doc.title] as const,
      ),
    ),
  );
};

/**
 * `?target` accepts a schema-validated JSON DocumentRequest for exact picker selections.
 * A document Address (path or cloud GUID) names the document in whichever
 * session holds it open; anything else is a session key and names that session's one open document.
 */
export function parseTarget(
  target: string | null | undefined,
):
  | { kind: "address"; address: Address }
  | { kind: "session"; session: string }
  | { kind: "request"; request: DocumentRequest }
  | null {
  if (!target) return null;
  if (target.startsWith("{")) {
    try {
      const request = documentRequestSchema.safeParse(JSON.parse(target));
      return request.success
        ? { kind: "request", request: request.data }
        : { kind: "session", session: target };
    } catch {
      return { kind: "session", session: target };
    }
  }
  const parsed = addressSchema.safeParse(target);
  return parsed.success
    ? { kind: "address", address: parsed.data }
    : { kind: "session", session: target };
}

/**
 * The route's Target: the thread head or a `?target` pin, resolved against the live inventory,
 * the bound document that left it (named, never rebound), and the resolved document's Address.
 */
export function useRouteTarget(
  manifest: Pick<RouteManifest<any, any, any, any>, "needs" | "readings">,
  registry: AtomRegistry.AtomRegistry,
  seed: { target?: ExecutionTarget } | undefined,
  target: string | null,
  thread: string | undefined,
) {
  const inventory = useMemo(
    () => (seed ? null : readingAtom({ kind: "inventory" }, peReadings)),
    [seed],
  );
  const inventoryResult = (useOwned(registry, inventory) ?? {
    state: "absent",
  }) as Reading<unknown>;
  /**
   * The route's default Target is whatever the thread head says. A route that declares a
   * `thread-head` Reading resolves against it; one that does not has no default and refuses until
   * a document is chosen. No component keeps a second copy (fable law 6).
   */
  const headRequest = useMemo(
    () =>
      (thread
        ? { kind: "thread-head", thread: thread }
        : Object.values(manifest.readings ?? {}).find(
            (request) =>
              typeof request !== "function" &&
              (request as ReadingRequest | undefined)?.kind === "thread-head",
          )) as Extract<ReadingRequest, { kind: "thread-head" }> | undefined,
    [manifest.readings, thread],
  );
  const headAtom = useMemo(
    () => (!seed && headRequest ? readingAtom(headRequest, peReadings) : null),
    [headRequest, seed],
  );
  const headResult = useOwned(registry, headAtom) as Reading<unknown> | null;
  const scope = useThreadScope(
    headRequest?.thread ?? "",
    headResult !== null,
    headResult ?? { state: "absent" },
  );
  const defaultDocument = useMemo(
    () =>
      threadHeadSchema.safeParse(headResult ? previousOf(headResult) : undefined).data
        ?.defaultTarget ?? null,
    [headResult],
  );
  const resolution: TargetResolution = useMemo(() => {
    // A seed's explicit synthetic Target is its authority; host is the backward-safe absence.
    if (seed)
      return {
        kind: "resolved",
        target: seed.target ?? ({ kind: "host" } as ExecutionTarget),
      };
    if (!manifest.needs) return { kind: "resolved", target: { kind: "host" } as ExecutionTarget };
    // Adding a document Reading reconnects the shared stream. Retain the observed target
    // across that gap, or dropping its Readings would trigger another reconnect forever.
    const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);

    // A chosen `?target` beats the thread head; see `parseTarget` for the grammar.
    const chosen = parseTarget(target);
    let request: DocumentRequest | null = defaultDocument;
    if (chosen && inventory.kind === "ready") {
      if (chosen.kind === "request") {
        request = chosen.request;
      } else if (chosen.kind === "session") {
        const found = inventory.sessions[chosen.session];
        if (!found) return { kind: "choose", reason: "session-gone" };
        if (found.kind !== "ready") return found;
        if (found.values.length === 0) return { kind: "choose", reason: "document-closed" };
        if (found.values.length > 1) return { kind: "choose", reason: "ambiguous" };
        request = {
          kind: "open",
          ref: { session: chosen.session, openId: found.values[0]!.openId },
        };
      } else {
        const holders = Object.entries(inventory.sessions).filter(
          ([, found]) =>
            found.kind === "ready" &&
            found.values.some(
              (doc) => doc.address !== null && sameAddress(doc.address, chosen.address),
            ),
        );
        if (holders.length === 0) return { kind: "choose", reason: "document-closed" };
        if (holders.length > 1) return { kind: "choose", reason: "ambiguous" };
        request = { kind: "named", session: holders[0]![0], address: chosen.address };
      }
    }
    const session = request?.kind === "open" ? request.ref.session : request?.session;
    const needs =
      manifest.needs === "session"
        ? ({ needs: "session", target: session ?? "" } as const)
        : ({
            needs:
              manifest.needs === "family"
                ? ("family-document" as const)
                : manifest.needs === "project"
                  ? ("project-document" as const)
                  : ("document" as const),
          } as const);
    if (needs.needs === "session" && !needs.target) return { kind: "choose", reason: "missing" };
    return resolveCallTarget(needs as never, request, inventory);
  }, [seed, manifest.needs, inventoryResult, defaultDocument, target]);

  // A bound exact document that left the inventory: named, with the title it last had, and the
  // same title reopened in its session offered. Titles seen are remembered for exactly this.
  const seenTitles = useRef(new Map<string, string>());
  const open = useMemo(() => openTitles(inventoryResult), [inventoryResult]);
  for (const [id, title] of open) seenTitles.current.set(id, title);
  const bindingLost = useMemo((): BindingLost | null => {
    if (seed || resolution.kind !== "choose") return null;
    if (resolution.reason !== "document-closed" && resolution.reason !== "session-gone")
      return null;
    const chosen = parseTarget(target);
    const pinned = chosen?.kind === "request";
    const request = pinned ? chosen.request : defaultDocument;
    if (request?.kind !== "open") return null;
    const { ref } = request;
    const title = seenTitles.current.get(`${ref.session}/${ref.openId}`) ?? null;
    const reopened =
      title === null
        ? null
        : ([...open].find(
            ([id, other]) =>
              other === title &&
              id.startsWith(`${ref.session}/`) &&
              id !== `${ref.session}/${ref.openId}`,
          ) ?? null);
    return {
      ref,
      title,
      // A `?target` pin is this page's own binding; a Chat head is the thread's (the words the
      // host's route door uses). Remembered titles only label it; they never rebind.
      sentence: pinned
        ? `the document this page was bound to closed (${title ?? "untitled"} · ${ref.openId.slice(0, 8)}…); bind it again in the sentence above`
        : `the Chat's document is no longer open — pick it again (${title ?? "untitled"} · ${ref.openId.slice(0, 8)}…)`,
      reason: resolution.reason,
      reopened: reopened
        ? { openId: reopened[0].slice(ref.session.length + 1), title: reopened[1] }
        : null,
    };
  }, [seed, resolution, target, defaultDocument, open]);
  const bindingLostRef = useRef(bindingLost);
  bindingLostRef.current = bindingLost;

  // The Work key is the resolved document's Address, so a session-key `?target` and an Address
  // `?target` for the same document read and write the same Work.
  const resolvedAddress = useMemo((): Address | null => {
    if (resolution.kind !== "resolved" || resolution.target.kind !== "document") return null;
    const inventory = targetInventory(inventoryResult as Parameters<typeof targetInventory>[0]);
    const found =
      inventory.kind === "ready" ? inventory.sessions[resolution.target.ref.session] : undefined;
    const ref = resolution.target.ref;
    return found?.kind === "ready"
      ? (found.values.find((doc) => doc.openId === ref.openId)?.address ?? null)
      : null;
  }, [resolution, inventoryResult]);
  const head = headRequest && headResult ? { thread: headRequest.thread, ...scope } : null;
  return { inventoryResult, head, resolution, bindingLost, bindingLostRef, resolvedAddress };
}
