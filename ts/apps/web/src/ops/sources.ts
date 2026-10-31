import { z } from "zod";
import { actionReceiptSchema, actionStatusSchema, type ReadEntry } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  isTsOnlyOperationKey,
} from "@pe/host-contracts/operation-types";
import { requestJson } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingSource } from "#/shell/readings";
import { runOp } from "./run";
import type { HostOperationCatalogEntry } from "./manifest";
export type OpsCatalog = { operations?: HostOperationCatalogEntry[]; bridgeCatalogError?: string };
export const opReadInput = z.object({
  op: z.custom<HostOperationCatalogEntry>(),
  request: z.unknown(),
});
export const opRead: ReadEntry<typeof opReadInput> = {
  key: "ops.read",
  input: opReadInput,
  run: async ({ op, request }, { target }) => {
    const headers: Record<string, string> = { [HOST_RPC_ORIGIN_HEADER]: "web:/ops" };
    if (!isTsOnlyOperationKey(op.key) && target.kind === "document") {
      headers[HOST_RPC_BRIDGE_SESSION_HEADER] = target.ref.session;
      headers[HOST_RPC_DOCUMENT_HEADER] = target.ref.openId;
    } else if (!isTsOnlyOperationKey(op.key) && target.kind === "session")
      headers[HOST_RPC_BRIDGE_SESSION_HEADER] = target.session;
    const result = await runOp({
      op,
      request,
      target,
      call: (key, ...args) =>
        requestJson(
          { path: "/call", body: { key, request: args[0] }, headers },
          z.any(),
          AbortSignal.timeout(30_000),
        ),
    });
    return {
      ...result,
      op: op.key,
      request,
      document: target.kind === "document" ? target.ref : null,
    };
  },
};
export const receiptControlInput = z.object({
  key: z.enum(["action.read", "action.recover", "action.resume", "action.cancel"]),
  id: z.string().min(1),
});
export const receiptControlRpc: ReadEntry<typeof receiptControlInput> = {
  key: "ops.receipt-control",
  input: receiptControlInput,
  async run({ key, id }) {
    const { peRouteUrl } = await import("@pe/agent-contracts/pe-api");
    if (key === "action.read") {
      const rows = await requestJson(
        { path: peRouteUrl("actions.read", { query: { id } }) },
        z.array(actionReceiptSchema),
        AbortSignal.timeout(30_000),
      );
      const row = rows.find((row) => row.id === id);
      if (!row) throw Error("Original action not found");
      return row;
    }
    return requestJson(
      { path: peRouteUrl(key, {}), body: { id } },
      actionReceiptSchema,
      AbortSignal.timeout(30_000),
    );
  },
};
export function opsSources(): Readonly<Record<string, ReadingSource>> {
  return {
    "ops.catalog": subscriptionSource({
      request: ({ target }) => ({
        kind: "ops-catalog",
        ...(target.kind === "document"
          ? { session: target.ref.session }
          : target.kind === "session"
            ? { session: target.session }
            : {}),
      }),
      decode: (value) => value as OpsCatalog,
    }),
    "ops.receipt": {
      kind: "use",
      open(ctx, deliver) {
        const id = (ctx.page as { actionId: string }).actionId;
        if (!id) return deliver({ kind: "complete", value: [], revision: 0 });
        return subscriptionSource({
          request: () => ({ kind: "receipts", id }),
          decode: (value) => z.array(actionReceiptSchema).parse(value),
          dirties: ["receipts"],
        }).open(ctx, deliver);
      },
    },
    "ops.receipts": subscriptionSource({
      request: () => ({ kind: "receipts" }),
      decode: (value) => z.array(actionStatusSchema).parse(value),
      dirties: ["receipts"],
    }),
  };
}
