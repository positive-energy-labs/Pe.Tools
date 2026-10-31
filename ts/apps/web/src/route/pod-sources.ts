import { z } from "zod";
import {
  parseContributionKey,
  type Machine,
  type PodRouteDescriptor,
  type ReadEntry,
} from "@pe/agent-contracts";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import {
  isAnyOperationKey,
  tsOnlyOperationCatalog,
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { peClient } from "#/host/pe-client";
import { requestJson } from "#/shell/readings-api";
import type { ReadingSource } from "#/shell/readings";
import { subscriptionSource } from "#/shell/readings-use";

export const podRequest = z.object({ key: z.string(), input: z.record(z.string(), z.unknown()) });
export function podOperation(key: string) {
  if (!isAnyOperationKey(key)) throw Error(`Unknown operation ${key}`);
  const op =
    tsOnlyOperationCatalog.find((op) => op.key === key) ??
    hostOpCatalog.find((op) => op.key === key);
  const intent = op?.intent?.toLowerCase();
  if (!op || (intent !== "read" && intent !== "mutate"))
    throw Error(`Operation readiness metadata is unavailable for ${key}`);
  return { ...op, intent };
}
export const podRead: ReadEntry<typeof podRequest> = {
  key: "pod.read",
  input: podRequest,
  async run({ key, input }, { target }) {
    if (podOperation(key).intent.toLowerCase() !== "read")
      throw Error("Mutations require action admission");
    if (target.kind !== "document") throw Error("Choose an exact document");
    return requestJson(
      {
        path: "/call",
        body: { key, request: input },
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.ref.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.ref.openId,
        },
      },
      z.unknown(),
      AbortSignal.timeout(120_000),
    );
  },
};
export const podScript: ReadEntry<typeof podRequest> = {
  key: "pod.script",
  input: podRequest,
  async run({ key, input }) {
    const reference = parseContributionKey(key);
    if (reference?.kind !== "script") throw Error(`${key} is not an executable script.`);
    const captured = await peClient.call("contributions.read", { query: { key } });
    if (!captured.sourceBundle) throw Error(`${key} has no captured source bundle.`);
    return {
      key: "scripting.execute",
      input: {
        sourcePath: reference.path,
        sourceBundle: captured.sourceBundle,
        ...Object.fromEntries(
          ["permissionMode", "timeoutSeconds"]
            .filter((name) => input[name] !== undefined)
            .map((name) => [name, input[name]]),
        ),
      },
    };
  },
};
export const podExport = (
  row: PodRouteDescriptor,
): ReadEntry<z.ZodObject<{ snapshot: z.ZodUnknown }>> => ({
  key: "page.export",
  input: z.object({ snapshot: z.unknown() }),
  async run({ snapshot }) {
    if (!row.page) throw Error("This route declares no portable Page.");
    const slug = `${row.packageId.replace(/^@/, "")}--${row.page.replace(/^pages\//, "")}`;
    const response = await peClient.response("page.export", {
      params: { slug },
      body: { snapshot },
    });
    if (!response.ok) throw Error(`Page export refused (${response.status}).`);
    const url = URL.createObjectURL(await response.blob());
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${slug}.html`;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
});
export const podSources: Readonly<Record<string, ReadingSource>> = {
  "pod.machine": subscriptionSource({
    request: () => ({ kind: "machine" }),
    decode: (value) => value as Machine,
  }),
  "pod.state": { kind: "derive", derive: (ctx) => (ctx.work as { state: unknown } | null)?.state },
};
