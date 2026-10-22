import { createHash } from "node:crypto";
import { HostLog } from "../src/host-log.ts";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import {
  address,
  bindWork,
  emptyThreadLifecycle,
  navigationSnapshotSchema,
  workKey,
} from "@pe/agent-contracts";
import { RouteWorkspace, type RouteWorkspaceRegistration } from "@pe/runtime";
import { createPeRoutes } from "../src/pe-routes.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { readNavigation } from "../src/navigation.ts";
import { createHarnessThreads, type HarnessThreadsOptions } from "../src/harness/threads.ts";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});
const temporary = async () => {
  const directory = await mkdtemp(join(tmpdir(), "pe-navigation-"));
  directories.push(directory);
  return directory;
};
const registration = (route = "family"): RouteWorkspaceRegistration => ({
  spec: {
    route,
    title: route === "family" ? "Family Foundry" : route,
    description: "Navigation proof",
    schema: z.object({ secret: z.string().default("") }).prefault({}),
    agentWriteMask: [["secret"]],
    commands: {},
  },
  handlers: {},
});
const envelope = { version: 1, revision: 3, doc: { secret: "PRIVATE-RAW-WORK" } };
const filename = (targetKey: string, route: string) =>
  `${createHash("sha256").update(`${route}:${targetKey}`).digest("hex")}.json`;
const bytes = async (directory: string) =>
  Promise.all(
    (await readdir(directory))
      .sort()
      .map(async (file) => [file, await readFile(join(directory, file), "utf8")]),
  );

test("HTTP navigation resumes only the exact unique current document and reflects later writes", async () => {
  const store = fileRouteDocumentStore(await temporary());
  const scope = bindWork("family", address("C:\\Models\\A.rvt"));
  await store.setState({ targetKey: workKey(scope), route: "family", value: envelope });
  let documents = [
    { session: "process-incarnation", openId: "open-lifetime", address: scope.target },
  ];
  const app = createPeRoutes({
    registrations: [registration()],
    store,
    heads: { observe: () => () => {} },
    navigation: { threads: async () => [], documents: async () => documents },
  });
  const read = async () =>
    navigationSnapshotSchema.parse(
      await (await app.fetch(new Request("http://host/pe/navigation"))).json(),
    );
  const linked = (await read()).works[0]!;
  const url = new URL(linked.url!, "http://host");
  expect(url.pathname).toBe("/family");
  expect(JSON.parse(url.searchParams.get("target")!)).toEqual({
    kind: "open",
    ref: { session: "process-incarnation", openId: "open-lifetime" },
  });
  await store.setState({
    targetKey: workKey(scope),
    route: "family",
    value: { ...envelope, revision: 4 },
  });
  expect((await read()).works[0]!.revision).toBe(4);
  documents = [...documents, { ...documents[0]!, session: "another-process" }];
  expect((await read()).works[0]).toMatchObject({
    url: null,
    reason: "This address has multiple current document bindings.",
  });
  documents = [];
  expect((await read()).works[0]!.url).toBeNull();
  expect((await read()).works[0]!.reason).toContain("not currently available");
});

test("transplanted identity and malformed data are reported without mutating their files", async () => {
  const directory = await temporary();
  const store = fileRouteDocumentStore(directory);
  const scope = bindWork("family", address("C:\\Models\\A.rvt"));
  const other = bindWork("family", address("C:\\Models\\B.rvt"));
  await store.setState({ targetKey: workKey(scope), route: "family", value: envelope });
  const path = join(directory, filename(workKey(scope), "family"));
  const content = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...content, targetKey: workKey(other) }));
  const before = await bytes(directory);
  expect(await store.listState!()).toMatchObject({ records: [], unreadable: 1 });
  await expect(store.getState({ targetKey: workKey(scope), route: "family" })).rejects.toThrow(
    "identity",
  );
  expect(await bytes(directory)).toEqual(before);
});

test("Pea navigation reads real persisted harness summaries and preserves thread identity", async () => {
  const directory = await temporary();
  // Seed the canonical disk record. POST /threads starts a harness; this proof is read-only.
  const id = "actual-saved-thread";
  const threadDirectory = join(directory, "threads", id);
  await mkdir(threadDirectory, { recursive: true });
  await writeFile(
    join(threadDirectory, "meta.json"),
    JSON.stringify({
      id,
      harness: "codex",
      providerId: "codex",
      providerName: "Codex",
      title: "Actual saved conversation",
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
      modelId: null,
      acpSessionId: null,
      models: [],
      traits: [],
      traitValues: {},
      head: { targets: [], revision: 0 },
      forkOf: null,
      promptCapabilities: null,
      lifecycle: emptyThreadLifecycle(),
    }),
  );
  const before = await bytes(threadDirectory);
  const providers = {
    get: () => ({ id: "codex", harness: "codex", name: "Codex", auth: { kind: "subscription" } }),
    keys: () => [],
  } as unknown as HarnessThreadsOptions["providers"];
  const options: HarnessThreadsOptions = {
    root: join(directory, "threads"),
    log: new HostLog(join(directory, "log")),
    worldRoot: directory,
    providers,
    mcpServer: () => ({ name: "unused", command: "unused", args: [], env: [] }),
  };
  const threads = createHarnessThreads(options);
  try {
    const workspace = new RouteWorkspace({
      registrations: [],
      store: fileRouteDocumentStore(join(directory, "work")),
    });
    const snapshot = await readNavigation(workspace, {
      threads: async () => (await threads.fetch(new Request("http://host/pe/threads"))).json(),
      documents: async () => [],
    });
    expect(snapshot.threads).toHaveLength(1);
    expect(snapshot.threads[0]).toMatchObject({
      id,
      route: "chat",
      label: "Actual saved conversation",
      url: `/pea?thread=${id}`,
      state: "idle",
    });
    expect(await bytes(threadDirectory)).toEqual(before);
  } finally {
    await threads.close();
  }
});
