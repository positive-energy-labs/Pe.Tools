import { z } from "zod";
import { contextFetch as fetch } from "@pe/runtime/context";
import type { ReadEntry } from "@pe/agent-contracts";

const actionControlInput = z.object({
  key: z.enum(["action.read", "action.recover", "action.resume", "action.cancel"]),
  id: z.string().min(1),
  base: z.string().default(""),
});
/** Receipt controls retain the original admission and its endpoint. */
export const actionControlRpc = {
  key: "action.control",
  input: actionControlInput,
  async run(input: z.input<typeof actionControlInput>) {
    const { controlAction } = await import("./takeoff-action-client.ts");
    const { key, id, base } = actionControlInput.parse(input);
    return controlAction(key, { id }, base);
  },
} satisfies ReadEntry<typeof actionControlInput>;

const shellOpenInput = z.object({ path: z.string().min(1) });
/** Opening a host path remains a journaled human admission, never a raw shell call. */
export const hostShellOpenRpc = {
  key: "host.shell.open",
  input: shellOpenInput,
  async run(input: z.input<typeof shellOpenInput>) {
    const { actionAdmissionSchema } = await import("@pe/agent-contracts");
    const { actionResult, submitAction } = await import("./takeoff-action-client.ts");
    actionResult(
      await submitAction(
        actionAdmissionSchema.parse({
          id: crypto.randomUUID(),
          key: "host.shell.open",
          target: { kind: "host" },
          input: shellOpenInput.parse(input),
        }),
        "",
        30_000,
      ),
    );
  },
} satisfies ReadEntry<typeof shellOpenInput>;

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
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw Error(body?.error ?? `Switch refused (${response.status}).`);
  },
} satisfies ReadEntry<typeof automaticUpdatesInput>;

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
