import { z } from "zod";
import type { DocumentRef } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { requestJson } from "#/shell/readings-api";

/** rhvac.open extracts the Jet file; only rhvac.launch starts the RHVAC application. */
export const takeoffReads = {
  "takeoffs.snapshot": { input: z.strictObject({}) },
  "rhvac.open": { input: z.strictObject({ path: z.string().min(1) }) },
} as const;
export type TakeoffReadKey = keyof typeof takeoffReads;
export function readTakeoff(
  key: TakeoffReadKey,
  input: Record<string, unknown>,
  target?: DocumentRef,
) {
  if (key === "takeoffs.snapshot" && !target) throw Error("Choose an open document first");
  return requestJson(
    {
      path: "/call",
      body: { key, request: takeoffReads[key].input.parse(input) },
      ...(target && {
        headers: {
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.openId,
        },
      }),
    },
    z.unknown(),
    AbortSignal.timeout(120_000),
  );
}
