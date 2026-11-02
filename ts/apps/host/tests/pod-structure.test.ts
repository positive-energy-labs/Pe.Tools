import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { podExecutor } from "../src/pod-executor.ts";
import { admitPodModule, podCommand, podReadRequest } from "../src/pod-routes.ts";
import { RouteWorkspace } from "@pe/runtime";
import { pane, workWriteCommand, writeIntentSchema } from "@pe/agent-contracts";
import type { CommandContext, CommandExecutor } from "../src/command-executor.ts";
import type { ActionExecution } from "../src/action-journal.ts";

// Every Pod passes this admission gate. Deliberately use unrelated namespaces and payloads.
for (const namespace of ["alpha", "beta"]) {
  const route = `pod.${namespace}.tool`, read = `pod.${namespace}.read`, write = `pod.${namespace}.write`;
  function fixture() {
    let transforms = 0;
    const definition = workWriteCommand(route, write, { axes: { subject: "Elements", touches: ["Metadata"], effect: "ModelWrite", cost: "Mutation", cardinality: "One" }, says: "Write", needs: "document", effect: "command", dirties: ["snapshot"], input: z.object({ value: z.string() }) });
    const query = { axes: { subject: "Elements", touches: ["Metadata"], effect: "Read", cost: "Cheap", cardinality: "One" }, says: "Read", needs: "document", effect: "query", dirties: [], input: z.object({ value: z.string() }) } as const;
    const native: CommandExecutor = {
      definition, prepared: z.unknown(),
      bind: async ctx => ({ effects: [], prepare: async () => ctx.admission.input }),
      run: async (ctx, execution) => ({ dispatched: ctx.admission.input, prepared: execution.prepared }),
    };
    const entries = { [read]: query, [write]: definition };
    const bodies = Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, podExecutor({ key: "native.test", definition: entry,
      input: input => { transforms++; return { transformed: input.value }; },
      retires: entry.effect === "command" ? () => [["writeIntent", key]] : undefined,
    }, native)]));
    const module = { version: 1 as const, namespace, key: `${namespace}:${route}`, moduleHash: "a".repeat(64),
      work: { route, schemaVersion: 1, schema: z.object({ writeIntent: writeIntentSchema }), editable: [["writeIntent", "*"]] }, entries, bodies,
      graph: { stages: { use: { word: "Use", panes: ["main"], verbs: [], teach: "Test" } }, stageOrder: ["use"], key: route, name: "Tool", address: route, directory: { path: `/${route}` }, fields: {}, readings: {}, verbs: {}, panes: { main: { label: "Tool", purpose: "Test", draws: [], verbs: [] } }, layout: pane("main") },
    } as unknown as Parameters<typeof admitPodModule>[0];
    const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => null, setState: async () => {} } });
    return { module, workspace, transforms: () => transforms };
  }
  test(`${namespace}: reads cannot enter the mutation gateway and transform once before /call`, async () => {
    const f = fixture(), dispose = admitPodModule(f.module, f.module.moduleHash, f.workspace);
    try {
      expect(podCommand(read)).toBeUndefined();
      expect(podReadRequest(read, { value: "observed" })).toEqual({ key: "native.test", request: { transformed: "observed" } });
      expect(f.transforms()).toBe(1);
      await expect(f.module.bodies[read]!.bind({} as CommandContext)).rejects.toThrow("never the mutation gateway");
      expect(() => podReadRequest(write, {})).toThrow("mutations require");
    } finally { dispose(); }
  });
  test(`${namespace}: dispatch uses sealed transformed input even when the caller changes`, async () => {
    const f = fixture(), executor = f.module.bodies[write]!;
    const ctx = { admission: { input: { value: "sealed" } } } as unknown as CommandContext;
    const bound = await executor.bind(ctx), prepared = await bound.prepare!();
    ctx.admission.input.value = "changed";
    expect(await executor.run(ctx, { prepared } as ActionExecution)).toEqual({ dispatched: { transformed: "sealed" }, prepared: { transformed: "sealed" } });
    expect(f.transforms()).toBe(1);
    expect(Object.isFrozen(executor)).toBe(true);
  });
  test(`${namespace}: any arbitrary gateway body or missing write declarations fails admission`, () => {
    for (const defect of ["gateway", "retirement", "invalidation"]) {
      const f = fixture();
      if (defect === "gateway") f.module.bodies[read] = { ...f.module.bodies[read]! };
      else {
        const entry = f.module.entries[write]!;
        if (defect === "invalidation") entry.dirties = [];
        if (defect === "retirement") f.module.bodies[write] = podExecutor({ key: "native.test", definition: entry, input: x => x }, f.module.bodies[write]!);
      }
      expect(() => admitPodModule(f.module, f.module.moduleHash, f.workspace)).toThrow(defect === "gateway" ? "sealed operation adapter" : "retirement and reading invalidation");
    }
  });
}
