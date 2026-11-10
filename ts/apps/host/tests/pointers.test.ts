import { consentService, harnessThreads, testSpawner } from "./effect-test.ts";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withInvocationContext } from "@pe/runtime/context";
import { createProviders } from "../src/harness/providers.ts";
import { HostLog } from "../src/host-log.ts";
import { pointerThread, threadPointerPort } from "../src/thread-pointers.ts";
import { human } from "./callers.ts";

let root = "";
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-pointers-"));
  process.env.PE_HARNESS_ADAPTER_CLAUDE = join(import.meta.dirname, "fake-acp-agent.mjs");
});
afterAll(async () => {
  delete process.env.PE_HARNESS_ADAPTER_CLAUDE;
  await rm(root, { recursive: true, force: true });
});
const open = () =>
  harnessThreads({
    runs: consentService(),
    root: join(root, "threads"),
    log: new HostLog(join(root, "log"), Date.now),
    worldRoot: tmpdir(),
    mcpServer: () => ({ name: "pea", command: "unused", args: [], env: [] }),
    providers: createProviders({ spawner: testSpawner(), shellPath: async () => "", probeOnStart: false }),
  });

test("a pointer lives in thread meta: it survives a host reload and leaves only by dismissal", async () => {
  const first = await open();
  const created = await withInvocationContext({ caller: human }, () =>
    first.fetch(
      new Request("http://host/pe/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "claude" }),
      }),
    ),
  );
  const id = ((await created.json()) as { id: string }).id;
  // The call route reaches thread meta only through the injected port.
  const port = threadPointerPort();
  expect(() => port.read(id)).toThrow(/unavailable/);
  port.bind(first.pointers);
  const pea = { kind: "pea", thread: id } as never;
  port.point(pointerThread(pea, "another-thread"), {
    route: "fans",
    target: { selected: '["UniqueId:u-7"]' },
    label: "FC-1 fan flow",
  });
  await first.close();

  const second = await open();
  port.bind(second.pointers);
  const [pointer] = port.read(pointerThread({ kind: "human" } as never, id)).pointers;
  expect(pointer).toMatchObject({ route: "fans", label: "FC-1 fan flow", target: { selected: '["UniqueId:u-7"]' } });
  port.dismiss(id, pointer!.id);
  await second.close();

  const third = await open();
  expect(third.pointers.read(id).pointers).toEqual([]);
  await third.close();
  expect(() => pointerThread({ kind: "human" } as never, undefined)).toThrow(/thread/);
  expect(() => pointerThread({ kind: "anonymous" } as never, id)).toThrow();
});
