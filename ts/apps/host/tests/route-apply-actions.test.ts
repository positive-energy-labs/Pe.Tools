import { expect, test, vi } from "vite-plus/test";
import { commands } from "@pe/agent-contracts";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import type { CommandExecutor, CommandContext } from "../src/command-executor.ts";
import { detachedBridge } from "./effect-test.ts";
import { z } from "zod";

vi.mock("../src/family-actions.ts", async (actual) => ({
  ...(await actual<typeof import("../src/family-actions.ts")>()),
  lifetime: async () => ({ session: { state: { openDocuments: [] } }, process: {} }),
}));

// Payload/plan-ticket fixtures belonged to the retired caller-payload boundary.
// Every migrated command must bind executable derivation and refuse foreign Work first.
const writes = Object.entries(commands).filter(([, entry]) => "writeBoundary" in entry);
test.each(writes)(
  "%s links derivation and refuses foreign Work without reading evidence",
  async (key, definition) => {
    const entry = definition as (typeof commands)["schedule.apply"];
    expect(typeof entry.writeBoundary.derive).toBe("function");
    expect(typeof entry.writeBoundary.preview).toBe("function");
    const executor: CommandExecutor = {
      definition,
      prepared: z.unknown(),
      seal: () => {
        throw Error("must not project foreign Work");
      },
      bind: async () => {
        throw Error("must not derive foreign Work");
      },
      run: async () => {
        throw Error("must not dispatch foreign Work");
      },
    };
    const ctx = {
      admission: {
        id: "foreign",
        key,
        target: { kind: "document", ref: { session: "A", openId: "A" } },
        input: (() => {
          const foreign = {
            binding: "open",
            route: entry.writeBoundary.route,
            target: null,
            open: { session: "A", openId: "B" },
          };
          return { work: { key: foreign, revision: 1 } };
        })(),
      },
    } as unknown as CommandContext;
    const boundary = workWriteBoundary(executor, detachedBridge());
    await expect(boundary.bind(ctx)).rejects.toThrow("another document");
    expect(() =>
      workWriteBoundary(
        {
          ...executor,
          definition: {
            ...entry,
            writeBoundary: { ...entry.writeBoundary, derive: undefined },
          } as never,
        },
        {} as never,
      ),
    ).toThrow("typed derive and preview");
  },
);
