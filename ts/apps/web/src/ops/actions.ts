import { effectDecoder } from "@pe/host-contracts/decoders";
import { hostOperationDefinitionSchema } from "@pe/host-contracts/contracts";
import { z } from "zod";
import { type ReadEntry } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
  HOST_RPC_ORIGIN_HEADER,
  isTsOnlyOperationKey,
} from "@pe/host-contracts/operation-types";
import { callOp, callCompose } from "../host/catalog-client";

import { runOp } from "./run";
import type { HostOperationCatalogEntry } from "./manifest";
export type OpsCatalog = { operations?: HostOperationCatalogEntry[]; bridgeCatalogError?: string };
export const opReadInput = z.object({
  op: effectDecoder(hostOperationDefinitionSchema),
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
        callOp(
          { signal: AbortSignal.timeout(30_000), headers: headers },
          key,
          args[0] as import("@pe/host-contracts/operation-types").OpRequestOf<typeof key>,
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
    const context = { signal: AbortSignal.timeout(30_000) };
    if (key === "action.read") {
      const rows = await callCompose(context, "actions.read", { query: { id } });
      const row = rows.find((row) => row.id === id);
      if (!row) throw Error("Original action not found");
      return row;
    }
    return callCompose(context, key, { body: { id } });
  },
};
