import { invokeCommand } from "./command-fixture.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { expect, test } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { StepFailure, command } from "../src/command-executor.ts";

test.each([false, true])(
  "confirmed native commit resumes retirement after restart and preserves later edits: changed=%s",
  async (changed) => {
    const directory = await mkdtemp(join(tmpdir(), "pe-effect-freshness-"));
    try {
      const schema = z.object({
        fields: z
          .record(
            z.string(),
            z.object({ edit: z.object({ value: z.number() }).nullable().optional() }),
          )
          .default({}),
      });
      const spec = {
        route: "freshness",
        title: "Freshness",
        description: "Probe",
        schema,
        editable: [["fields", "*"]],
      };
      const saved = new Map<string, unknown>();
      const work = new RouteWorkspace({
        registrations: [{ spec }],
        store: {
          getState: async ({ targetKey, route }) =>
            saved.get(JSON.stringify([targetKey, route])) ?? null,
          setState: async ({ targetKey, route, value }) => {
            saved.set(JSON.stringify([targetKey, route]), value);
          },
        },
      });
      const key = bindWork(spec.route, null);
      await work.publish(
        key,
        spec.route,
        [{ path: ["fields", "chosen"], value: { edit: { value: 13 } } }],
        0,
      );
      const handle = { key, revision: (await work.view(key, spec.route))!.revision };
      const journal = new ActionJournal(join(directory, "commands.jsonl"));
      let destination = "destination-before",
        writes = 0;
      const executor = command(
        {
          says: "Write reviewed value",
          needs: "nothing",
          effect: "command",
          dirties: [],
          input: z.object({}),
        },
        z.null(),
        {
          async bind(context) {
            await context.selectWork(spec, handle);
            return {
              effects: [{ kind: "file", path: "destination" }],
            };
          },
          recover: async (step) => ({
            step: {
              ...step,
              state: "succeeded",
              result: { written: 13, changes: [{ before: "old", after: "new" }] },
            },
            evidence: { nativeReceipt: "confirmed" },
          }),
          async run(_context, execution) {
            await execution.step("native", "write", {}, async (id) => {
              await journal.markDispatched(id);
              writes++;
              destination = "destination-after";
              throw new StepFailure("Disconnected after commit", 503, "unknown");
            });

            return execution.retireWork(key, spec.route, [["fields", "chosen"]]);
          },
        },
      );
      journal.bindCommands({
        work,
        resolve: () => executor,
        probe: async (dependency) => {
          if (dependency.kind !== "file") throw Error("Unexpected source");
          return destination;
        },
      });
      await journal.invoke(
        { id: "once", key: "probe.write", target: { kind: "host" }, input: {} },
        { caller: { kind: "human", via: "local" }, basis: null },
      );
      expect((await journal.wait("once")).state).toBe("unknown");
      if (changed)
        await work.publish(
          key,
          spec.route,
          [{ path: ["fields", "chosen", "edit"], value: { value: 21 } }],
          handle.revision,
        );
      const restarted = new ActionJournal(join(directory, "commands.jsonl"));
      restarted.bindCommands({
        work,
        resolve: () => executor,
        probe: async () => "destination-after",
        target: async () => {
          throw Error("Original session is gone");
        },
      });
      const result = await restarted.recover("once");
      expect(writes).toBe(1);
      expect(result.state).toBe("succeeded");
      expect(result.steps[0]).toMatchObject({
        state: "succeeded",
        result: { written: 13, changes: [{ before: "old", after: "new" }] },
      });
      const reloaded = (await new ActionJournal(join(directory, "commands.jsonl")).list())[0]!;
      expect(reloaded.steps[0]).toMatchObject({
        result: { changes: [{ before: "old", after: "new" }] },
      });
      expect(reloaded.outcome).toMatchObject({ id: "once", state: "succeeded", input: {} });
      const current = schema.parse((await work.view(key, spec.route))!.doc);
      expect(current.fields.chosen?.edit).toEqual(changed ? { value: 21 } : null);
      expect(
        (await restarted.resume("once", { caller: { kind: "human", via: "local" }, basis: null }))
          .state,
      ).toBe("succeeded");
      expect(writes).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("resume reconciles uncertain native effects before permitting any retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-unknown-retry-"));
  try {
    const journal = new ActionJournal(join(directory, "commands.jsonl"));
    let writes = 0,
      reads = 0;
    const crossing = { caller: { kind: "human" as const, via: "local" as const }, basis: null };
    await invokeCommand(
      journal,
      { id: "uncertain", key: "probe.uncertain", target: { kind: "host" }, input: {}, ...crossing },
      async () => null,
      async (execution) =>
        execution.step("native", "write", {}, async () => {
          writes++;
          throw new StepFailure("Disconnected", 503, "unknown");
        }),
      false,
      {
        recover: async (step) => {
          reads++;
          return { step, evidence: { unavailable: true } };
        },
      },
    );
    expect((await journal.wait("uncertain")).state).toBe("unknown");
    expect((await journal.resume("uncertain", crossing)).state).toBe("unknown");
    expect(reads).toBe(1);
    expect(writes).toBe(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
