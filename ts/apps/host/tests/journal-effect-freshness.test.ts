import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { expect, test } from "vite-plus/test";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { command } from "../src/command-executor.ts";

test.each([false, true])(
  "a recorded destination write never refreshes an unrelated source before retirement: changed=%s",
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
      let source = "source-before",
        destination = "destination-before",
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
              consumes: [
                { kind: "file", probe: { path: "source" }, expected: source },
                { kind: "file", probe: { path: "destination" }, expected: destination },
              ],
            };
          },
          async run(_context, execution) {
            await execution.step("file", "write", {}, async () => {
              writes++;
              destination = "destination-after";
              return { written: 13 };
            });
            if (changed) source = "source-after";
            return execution.retireWork(key, spec.route, [["fields", "chosen"]]);
          },
        },
      );
      journal.bindCommands({
        work,
        resolve: () => executor,
        probe: async (dependency) => {
          if (dependency.kind !== "file") throw Error("Unexpected source");
          return dependency.probe.path === "source" ? source : destination;
        },
      });
      await journal.invoke(
        { id: "once", key: "probe.write", target: { kind: "host" }, input: {} },
        { caller: { kind: "human", via: "local" }, basis: null },
      );
      const result = await journal.wait("once");
      expect(writes).toBe(1);
      expect(result.state).toBe(changed ? "incomplete" : "succeeded");
      expect(result.steps[0]).toMatchObject({ state: "succeeded", result: { written: 13 } });
      const current = schema.parse((await work.view(key, spec.route))!.doc);
      expect(current.fields.chosen?.edit).toEqual(changed ? { value: 13 } : null);
      if (changed)
        expect(result.refusal).toMatchObject({
          kind: "stale",
          consumed: [{ probe: { path: "source" } }],
        });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
