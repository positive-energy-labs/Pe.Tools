import { invokeCommand } from "./command-fixture.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { BridgeError } from "../src/bridge.ts";

test("native dispatch evidence survives both successful and failed outcome persistence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-dispatch-evidence-"));
  try {
    const path = join(dir, "journal.jsonl");
    const journal = new ActionJournal(path);
    for (const succeeds of [true, false]) {
      const id = String(succeeds);
      await invokeCommand(
        journal,
        {
          id,

          key: "test.native",
          target: { kind: "host" },
          input: {},

          caller: { kind: "human", via: "local" },
          basis: { kind: "human" },
          effects: [{ kind: "session", session: "fixture-native" }],
        },
        async () => null,
        async (execution) =>
          execution.step("native", "test.native", {}, async (requestId) => {
            await journal.markDispatched(requestId);
            expect((await journal.list(undefined, id))[0]!.steps[0]!.dispatchedAt).toEqual(
              expect.any(String),
            );
            if (!succeeds)
              throw new BridgeError("Native answered failure", 500, { dispatched: true });
            return { applied: true };
          }),
      );
      const receipt = await journal.wait(id);
      expect(receipt.steps[0]).toMatchObject({
        state: succeeds ? "succeeded" : "failed",
        dispatchedAt: expect.any(String),
      });
      expect((await new ActionJournal(path).list(undefined, id))[0]!.steps[0]!.dispatchedAt).toBe(
        receipt.steps[0]!.dispatchedAt,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
