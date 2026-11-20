import { z } from "zod";
import { contextFetch as fetch } from "@pe/runtime/context";
import type { ReadEntry } from "@pe/agent-contracts";

const automaticUpdatesInput = z.object({ enabled: z.boolean() });
export const automaticUpdatesRpc = {
  key: "host.update.automatic",
  input: automaticUpdatesInput,
  async run(input: z.input<typeof automaticUpdatesInput>): Promise<void> {
    const response = await fetch("/host/update/automatic", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(automaticUpdatesInput.parse(input)),
    });
    if (response.ok) return;
    const body = (await response.json().catch((error) => {
      console.error("rpc-client: asynchronous operation failed", error);
      return null;
    })) as { error?: string } | null;
    throw Error(body?.error ?? `Switch refused (${response.status}).`);
  },
} satisfies ReadEntry<typeof automaticUpdatesInput>;
