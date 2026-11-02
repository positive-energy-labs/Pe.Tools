import { test, expect } from "vite-plus/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Effect } from "effect";
import * as contracts from "@pe/agent-contracts";
import { createRouteRegistry } from "../../../packages/kit/src/route-registry.ts";
import { RouteWorkspace } from "@pe/runtime";
import { admitPodModule, podCommand } from "../src/pod-routes.ts";
import { workWriteBoundary } from "../src/work-write-boundary.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { commandLeafRefusal } from "../src/bridge.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { buildCapabilities } from "../../../packages/mcps/src/pea/capabilities.ts";
import type { RevitBridge } from "../src/bridge.ts";
import type { CommandExecutor } from "../src/command-executor.ts";

async function fixture() {
  const bytes = await readFile(
    new URL("../../../../examples/pods/pipes/routes/pipes/index.js", import.meta.url),
  );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const source = await import(`data:text/javascript;base64,${bytes.toString("base64")}`);
  let writes = 0;
  const module = source.registerHost({
    ...contracts,
    z,
    descriptor: { key: "route:@pipes/routes/pipes/index.js", sha256 },
    operation: (): CommandExecutor => ({
      definition: {} as contracts.Command,
      prepared: z.unknown(),
      bind: async (ctx) => ({
        effects: [{ kind: "document", ref }],
        prepare: async () => ctx.admission.input,
      }),
      run: async (_ctx, execution) => {
        writes++;
        return { applied: execution.prepared };
      },
    }),
  }) as contracts.ExecutableRouteModule<CommandExecutor>;
  const saved = new Map<string, unknown>();
  const workspace = new RouteWorkspace({
    registrations: [],
    store: {
      getState: async ({ targetKey, route }) => saved.get(`${route}:${targetKey}`) ?? null,
      setState: async ({ targetKey, route, value }) => {
        saved.set(`${route}:${targetKey}`, value);
      },
    },
  });
  return { module, sha256, workspace, saved, writes: () => writes };
}
const ref = { session: "A", openId: "open-A" };
const bridge = {
  subscribe: () => () => {},
  list: Effect.succeed([
    {
      sessionId: "A",
      connected: true,
      lane: hostOwnership.lane,
      sourceRoot: hostOwnership.sourceRoot,
      serviceName: hostOwnership.serviceName,
      processId: 42,
      processStartUtcUnixMs: 1000,
      state: { openDocuments: [{ ...ref, isFamilyDocument: false }] },
    },
  ]),
} as unknown as RevitBridge["Service"];

test("pipes admission binds catalog, executable bodies and Work; migration and removal retain authored bytes", async () => {
  const f = await fixture();
  expect(() => admitPodModule(f.module, "0".repeat(64), f.workspace)).toThrow("hash mismatch");
  const key = contracts.bindWork(f.module.work.route, null, undefined, ref);
  f.saved.set(`${key.route}:${contracts.workKey(key)}`, {
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: { version: 1, state: { systemId: 12 } },
  });
  const dispose = admitPodModule(f.module, f.sha256, f.workspace);
  try {
    const view = await f.workspace.view(key, key.route);
    expect(view).toMatchObject({
      revision: 8,
      doc: { version: 2, state: { systemId: 12, label: "" }, writeIntent: {} },
    });
    expect((await f.workspace.view(key, key.route))?.revision).toBe(8);
    expect(podCommand("pod.pipes.set-parameter")).toBeDefined();
    expect(
      commandLeafRefusal("revit.apply.parameter-values", "pod.pipes.set-parameter"),
    ).toBeNull();
    expect(
      buildCapabilities({ ops: [], routes: [], packages: [], skills: [] }).some(
        (row) => row.key === "op:pod.pipes.set-parameter",
      ),
    ).toBe(true);
  } finally {
    dispose();
  }
  expect(podCommand("pod.pipes.set-parameter")).toBeUndefined();
  expect(
    commandLeafRefusal("revit.apply.parameter-values", "pod.pipes.set-parameter"),
  ).not.toBeNull();
  expect(await f.workspace.view(key, key.route)).toBeNull();
  expect(f.saved.size).toBe(1);
  expect(
    buildCapabilities({ ops: [], routes: [], packages: [], skills: [] }).some(
      (row) => row.key === "op:pod.pipes.set-parameter",
    ),
  ).toBe(false);
});

test("pipes preview and apply use the shared Work boundary and durable journal", async () => {
  const f = await fixture();
  const dispose = admitPodModule(f.module, f.sha256, f.workspace);
  const dir = await mkdtemp(join(tmpdir(), "pipes-journal-"));
  try {
    const key = contracts.bindWork(f.module.work.route, null, undefined, ref);
    await f.workspace.apply(
      key,
      key.route,
      "human",
      [
        {
          path: ["writeIntent", "pod.pipes.set-parameter"],
          value: { edit: { value: { elementId: 12, parameterId: 4, value: "P-1", expected: {} } } },
        },
      ],
      0,
    );
    const handle = { key, revision: (await f.workspace.view(key, key.route))!.revision };
    const journal = new ActionJournal(join(dir, "actions.jsonl"));
    journal.bindCommands({
      work: f.workspace,
      probe: async () => true,
      resolve: (key) => {
        const pod = podCommand(key)!;
        return workWriteBoundary(pod.executor, bridge, { sdk: sdkSessions }, undefined, pod.work);
      },
    });
    for (const previewOnly of [true, false]) {
      const id = previewOnly ? "preview" : "apply";
      await journal.invoke(
        {
          id,
          key: "pod.pipes.set-parameter",
          target: { kind: "document", ref },
          input: { work: handle, previewOnly },
        },
        { caller: { kind: "human", via: "local" }, basis: null },
      );
      const receipt = await journal.wait(id);
      expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
      expect(f.writes()).toBe(previewOnly ? 0 : 1);
    }
    dispose();
    expect(
      (await new ActionJournal(join(dir, "actions.jsonl")).list()).filter(
        (row) => row.state === "succeeded",
      ),
    ).toHaveLength(2);
  } finally {
    dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("pipes mounts through the builtin registry and rejects foreign builtin hashes", async () => {
  const f = await fixture();
  const registry = createRouteRegistry();
  const remove = registry.registerModule({ ...f.module, bodies: () => null });
  expect(registry.get("pod.pipes.pipes")?.graph?.subject?.({})).toBe("Piping system");
  remove();
  expect(registry.get("pod.pipes.pipes")).toBeUndefined();
  expect(() =>
    contracts.validateRouteModule({
      ...f.module,
      namespace: "builtin",
      key: "builtin:settings",
      graph: { ...f.module.graph, key: "settings" },
    }),
  ).toThrow("Builtin module hash");
});

test("failed migrations leave saved Work exact and inactive modules stop discovery immediately", async () => {
  const f = await fixture();
  const key = contracts.bindWork(f.module.work.route, null, undefined, ref);
  const saved = {
    version: 1,
    schemaVersion: 1,
    revision: 7,
    doc: { version: 1, state: { systemId: 12 } },
  };
  f.saved.set(`${key.route}:${contracts.workKey(key)}`, saved);
  f.module.work.migrations = {
    1: () => {
      throw Error("migration refused");
    },
  };
  let active = true;
  const dispose = admitPodModule(f.module, f.sha256, f.workspace, () => active);
  try {
    await expect(f.workspace.view(key, key.route)).rejects.toThrow("migration refused");
    expect([...f.saved.values()]).toEqual([saved]);
    active = false;
    expect(podCommand("pod.pipes.set-parameter")).toBeUndefined();
    expect(
      buildCapabilities({ ops: [], routes: [], packages: [], skills: [] }).some((row) =>
        row.key.startsWith("op:pod.pipes."),
      ),
    ).toBe(false);
  } finally {
    dispose();
  }
});
