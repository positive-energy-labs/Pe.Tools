/** Where a route acts: its `?target` pin, else the machine's sole user document as a fallback. */
import type { BridgeSessionListEntry } from "@pe/host-contracts/operation-types";
import { useMemo, useRef } from "react";
import {
  addressSchema,
  documentRequestSchema,
  resolveCallTarget,
  sameAddress,
  type Machine,
  type Address,
  type DocumentRequest,
  type ExecutionTarget,
  type Reading,
  type TargetResolution,
} from "@pe/agent-contracts";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { readingAtom, peReadings, inventoryOf, previousOf, targetInventory } from "#/readings";
import { soleUserDocument } from "#/chat/scope";
import { useOwned } from "#/shell/owner";

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
  | { kind: "invalid"; raw: string }
  | null {
  if (!target) return null;
  if (/^[{["]/.test(target.trimStart())) {
    try {
      const request = documentRequestSchema.safeParse(JSON.parse(target));
      return request.success
        ? { kind: "request", request: request.data }
        : { kind: "invalid", raw: target };
    } catch {
      return { kind: "invalid", raw: target };
    }
  }
  const parsed = addressSchema.safeParse(target);
  return parsed.success
    ? { kind: "address", address: parsed.data }
    : { kind: "session", session: target };
}

export type TargetProvenance =
  | { source: "url-pin"; raw: string }
  | { source: "sole-document" }
  | { source: "seed" | "none" };

/**
 * The route's Target: a `?target` pin resolved against the live inventory; with no pin, a fallback to
 * the machine's sole user document; else the route refuses until a document is chosen. Resolving
 * the fallback never writes target, head, or authority; explicit human actions remain subject to
 * existing freshness/admission. The selected conversation never defaults it.
 */
export function useRouteTarget(
  manifest: { readonly needs?: "session" | "document" | "project" | "family" },
  registry: AtomRegistry.AtomRegistry,
  seed: { target?: ExecutionTarget } | undefined,
  target: string | null,
) {
  const inventory = useMemo(
    () => (seed ? null : readingAtom({ kind: "inventory" }, peReadings)),
    [seed],
  );
  const inventoryResult = (useOwned(registry, inventory) ?? {
    state: "absent",
  }) as Reading<unknown>;
  const machineAtom = useMemo(
    () => (seed || target ? null : readingAtom({ kind: "machine" }, peReadings)),
    [seed, target],
  );
  const machineResult = useOwned(registry, machineAtom) as Reading<Machine> | null;
  const sole = machineResult ? soleUserDocument(previousOf(machineResult) ?? null) : null;
  const soleKey = JSON.stringify(sole);
  const fallback = useMemo((): DocumentRequest[] => (sole ? [sole] : []), [soleKey]);
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

    // See `parseTarget` for the `?target` grammar.
    const chosen = parseTarget(target);
    if (chosen?.kind === "invalid")
      return {
        kind: "failed",
        message: "?target is invalid JSON; choose an exact document again.",
      };
    let request: DocumentRequest | null = null;
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
    const sessionOf = request ?? (fallback.length === 1 ? fallback[0]! : null);
    const session = sessionOf?.kind === "open" ? sessionOf.ref.session : sessionOf?.session;
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
    return resolveCallTarget(needs as never, request ? [request] : fallback, inventory);
  }, [seed, manifest.needs, inventoryResult, fallback, target]);

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
    const request = pinned ? chosen.request : fallback.length === 1 ? fallback[0]! : null;
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
      // A `?target` pin is this page's own binding; the sole-document fallback is the machine's. Remembered titles only label it; they never rebind.
      sentence: pinned
        ? `the document this page was bound to closed (${title ?? "untitled"} · ${ref.openId.slice(0, 8)}…); bind it again in the sentence above`
        : `the Chat's document is no longer open — pick it again (${title ?? "untitled"} · ${ref.openId.slice(0, 8)}…)`,
      reason: resolution.reason,
      reopened: reopened
        ? { openId: reopened[0].slice(ref.session.length + 1), title: reopened[1] }
        : null,
    };
  }, [seed, resolution, target, fallback, open]);
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
  // Work identity alone: the live Address, else a known raw Address (a `?target` Address, or a
  // named request pinned or held by the fallback) so a closed document's Work stays readable. Never a
  // remembered title, and never an open/session ref reread as a new lifetime. Nothing native,
  // no action and no binding reads this; they stay on `resolution`.
  const workAddress = useMemo((): Address | null => {
    if (resolvedAddress || seed) return resolvedAddress;
    const chosen = parseTarget(target);
    const request =
      chosen?.kind === "request" ? chosen.request : chosen ? null : (fallback[0] ?? null);
    const raw =
      chosen?.kind === "address"
        ? chosen.address
        : request?.kind === "named" && (chosen || fallback.length === 1)
          ? request.address
          : null;
    return addressSchema.safeParse(raw).data ?? null;
  }, [resolvedAddress, seed, target, fallback]);
  // The same rule for an exact open request (a `?target` pin, or the sole fallback): it names
  // its own lifetime's saved Work, read-only, while native resolution says choose. The ref is
  // used as given, never re-resolved, so it never stands for a new lifetime.
  const workOpen = useMemo(() => {
    // Only once native resolution has answered "choose" (closed, gone): never while it is still
    // checking, when the same ref may yet resolve live and must stay armed.
    if (seed || resolution.kind !== "choose") return null;
    const chosen = parseTarget(target);
    const request =
      chosen?.kind === "request"
        ? chosen.request
        : chosen
          ? null
          : fallback.length === 1
            ? fallback[0]!
            : null;
    return request?.kind === "open" ? request.ref : null;
  }, [seed, resolution, target, fallback]);
  const targetProvenance: TargetProvenance = seed
    ? { source: "seed" }
    : target
      ? { source: "url-pin", raw: target }
      : fallback.length
        ? { source: "sole-document" }
        : { source: "none" };
  return {
    inventoryResult,
    resolution,
    bindingLost,
    bindingLostRef,
    resolvedAddress,
    workAddress,
    workOpen,
    targetProvenance,
  };
}
