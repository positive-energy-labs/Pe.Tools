import { Schema } from "effect";
import {
  type Caller,
  type ExecutionTarget,
  nativePrincipals,
  type Principal,
} from "@pe/agent-contracts";
import { hostOperationDefinitionSchema } from "@pe/host-contracts/contracts";
import { isTsOnlyOperationKey, tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { invokeBridge, type RevitBridge } from "./bridge.ts";
import { refused } from "./command-executor.ts";
import { Refused } from "./control.ts";
import type { SdkSession } from "./sdk-session.ts";

type CatalogEntry = { fingerprint: string; rows: Promise<unknown[]> };
const catalogs = new WeakMap<object, Map<string, CatalogEntry>>();

/** Registry bindings precede bridge registration. Retain metadata, never a native response/receipt. */
async function operationRows(bridge: RevitBridge["Service"], target: SdkSession) {
  const read = async () => {
    const { operations: rows } = await invokeBridge<{ operations?: unknown[] }>(
      bridge,
      { session: target.sessionId },
      "host.ops.catalog",
      {},
    );
    if (!Array.isArray(rows)) throw refused("Operation catalog unavailable");
    return rows;
  };
  let held = catalogs.get(bridge);
  if (!held) {
    held = new Map();
    catalogs.set(bridge, held);
    const entries = held;
    bridge.subscribe((event) => {
      if (event.kind === "connected" || event.kind === "disconnected")
        entries.delete(event.sessionId);
    });
  }
  const fingerprint = JSON.stringify([
    target.processId,
    target.processStartUtcUnixMs,
    target.buildStamp,
    target.state?.runtimeAssemblies,
  ]);
  const previous = held.get(target.sessionId);
  if (previous?.fingerprint === fingerprint) return previous.rows;
  const entries = held;
  const entry: CatalogEntry = { fingerprint, rows: Promise.resolve([]) };
  entries.set(target.sessionId, entry);
  entry.rows = read().then(
    (rows) => {
      if (entries.get(target.sessionId) !== entry)
        throw refused("Bridge attachment changed while reading operation catalog");
      return rows;
    },
    (error) => {
      if (entries.get(target.sessionId) === entry) entries.delete(target.sessionId);
      throw error;
    },
  );
  return entry.rows;
}
/** One rule for /call and /actions: a declared human-only op refuses every other caller. */
export function requireEligibleCaller(
  definition: { key: string; principal?: readonly Principal[]; intent?: string },
  caller: Caller,
  door: string,
) {
  if (definition.principal && !definition.principal.some((principal) => principal === caller.kind))
    throw new Refused({
      code: "human.only",
      door,
      reason: `'${definition.key}' is unavailable to ${caller.kind} callers.`,
    });
}
export async function operationDefinition(
  key: string,
  bridge: RevitBridge["Service"],
  target?: SdkSession,
) {
  const local = tsOnlyOperationCatalog.find((row) => row.key === key);
  if (local) return local;
  if (!target) throw refused("An SDK-resolved attachment is required");
  const rows = await operationRows(bridge, target);
  const raw = rows?.find(
    (row) => row && typeof row === "object" && "key" in row && row.key === key,
  );
  if (!raw) throw refused(`Catalog metadata unavailable for '${key}'`);
  let definition;
  try {
    definition = Schema.decodeUnknownSync(hostOperationDefinitionSchema)(raw);
    if (definition.intent !== "Read" && definition.intent !== "Mutate")
      throw refused(`Unknown operation intent for '${key}'`);
  } catch (error) {
    catalogs.get(bridge)?.delete(target.sessionId);
    throw error;
  }
  return {
    ...definition,
    principal: nativePrincipals(definition.actor),
  };
}
export function gatewayTarget(
  key: string,
  needs: string,
  session?: SdkSession,
  openDocumentId?: string,
): Exclude<ExecutionTarget, { kind: "sdk-session" }> {
  if (isTsOnlyOperationKey(key)) return { kind: "host" };
  if (!session) throw refused("An SDK-resolved attachment is required");
  if (needs === "nothing" || needs === "session")
    return { kind: "session", session: session.sessionId };
  const document = session.state?.openDocuments.find((doc) => doc.openId === openDocumentId);
  if (
    !document ||
    (needs === "family-document" && !document.isFamilyDocument) ||
    (needs === "project-document" && document.isFamilyDocument)
  )
    throw refused(
      "A matching exact open document lifetime is required; no active-document fallback",
    );
  return { kind: "document", ref: { session: session.sessionId, openId: document.openId } };
}
