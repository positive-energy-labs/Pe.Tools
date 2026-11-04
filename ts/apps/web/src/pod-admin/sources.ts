import { z } from "zod";
import { type ReadEntry } from "@pe/agent-contracts";
import { peClient } from "#/host/pe-client";
import { callOp } from "#/shell/readings-api";

export const installInput = z.object({ archivePath: z.string().min(1) });
export const installRpc: ReadEntry<typeof installInput> = {
  key: "pod.import",
  input: installInput,
  run: (request) => callOp({ signal: AbortSignal.timeout(30000) }, "pod.import", request),
};
export const trustInput = z.object({
  key: z.string(),
  fingerprint: z.string().regex(/^pod-bytes:[a-f0-9]{64}$/),
  trusted: z.boolean(),
});
export const trustRpc: ReadEntry<typeof trustInput> = {
  key: "plugins.routeTrust",
  input: trustInput,
  run: ({ key, ...body }) => peClient.call("plugins.routeTrust", { params: { key }, body }),
};

/** Activation stays human-only; this is a host RPC, never an agent semantic command. */
export const activationRpc: ReadEntry<z.ZodObject<{ id: z.ZodString; enabled: z.ZodBoolean }>> = {
  key: "plugin.update",
  input: z.object({ id: z.string().min(1), enabled: z.boolean() }),
  run: ({ id, enabled }) => peClient.call("plugin.update", { params: { id }, body: { enabled } }),
};
