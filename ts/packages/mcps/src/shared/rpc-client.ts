import { z } from "zod";
import { contextFetch as fetch } from "@pe/runtime/context";
import type { ReadEntry } from "@pe/agent-contracts";

async function answer(response: Response) {
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(
      Error(value.error?.message ?? value.error ?? `Host refused (${response.status})`),
      { status: response.status },
    );
  return value;
}
export const rhvacLaunchRpc: ReadEntry<z.ZodObject<{ path: z.ZodString }>> = {
  key: "rhvac.launch",
  input: z.object({ path: z.string().min(1) }),
  run: async (input) =>
    answer(
      await fetch("/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "rhvac.launch", request: input }),
      }),
    ),
};
export const pageBindRpc = {
  key: "page.bind",
  input: z.object({ slug: z.string().min(1), binding: z.unknown() }),
  run: async (input: { slug: string; binding: unknown }) => {
    // The API catalogue imports route graphs, which declare this door.
    const { createPeClient, peRoutes } = await import("@pe/agent-contracts/pe-api");
    return answer(
      await createPeClient("", fetch).response("page.bind", {
        params: { slug: input.slug },
        body: peRoutes["page.bind"].body.parse(input.binding),
      }),
    );
  },
};
