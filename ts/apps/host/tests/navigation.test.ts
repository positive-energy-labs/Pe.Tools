import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
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

test("mixed legacy and self-identifying files census real Work without creating or rewriting state", async () => {
  const directory = await temporary();
  const store = fileRouteDocumentStore(directory);
  const saved = bindWork("family", address("C:\\Models\\Actual.rvt"));
  const legacy = bindWork("family", address("C:\\Models\\Legacy.rvt"));
  await store.setState({ targetKey: workKey(saved), route: "family", value: envelope });
  await writeFile(join(directory, filename(workKey(legacy), "family")), JSON.stringify(envelope));
  await writeFile(join(directory, `${"f".repeat(64)}.json`), "{broken");
  const before = await bytes(directory);
  const workspace = new RouteWorkspace({ registrations: [registration()], store });
  const snapshot = await readNavigation(workspace, {
    threads: async () => [],
    documents: async () => [],
  });
  expect(snapshot.works).toHaveLength(1);
  expect(snapshot.works[0]).toMatchObject({
    id: workKey(saved),
    state: "ready",
    revision: 3,
    url: null,
  });
  expect(snapshot.observations.join(" ")).toContain("1 legacy hash-only");
  expect(snapshot.observations.join(" ")).toContain("1 stored files");
  expect(JSON.stringify(snapshot)).not.toContain("PRIVATE-RAW-WORK");
  expect(await store.getState({ targetKey: workKey(legacy), route: "family" })).toEqual(envelope);
  expect(await bytes(directory)).toEqual(before);
  // A later canonical write makes that exact Work discoverable, without a second index.
  await store.setState({ targetKey: workKey(legacy), route: "family", value: envelope });
  expect((await workspace.instances()).works).toHaveLength(2);
});

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

test("open, workspace, unreadable and retired route Work never acquire a fabricated resume link", async () => {
  const store = fileRouteDocumentStore(await temporary());
  const open = bindWork("family", null, undefined, { session: "s", openId: "unsaved" });
  const fixed = bindWork("instances", null, "instances");
  const arbitrary = bindWork("takeoffs", null, "not-a-capture");
  const broken = bindWork("family", address("C:\\Models\\Broken.rvt"));
  const retired = bindWork("retired", null);
  for (const scope of [open, fixed, arbitrary, retired])
    await store.setState({ targetKey: workKey(scope), route: scope.route, value: envelope });
  await store.setState({
    targetKey: workKey(broken),
    route: broken.route,
    value: { version: 1, revision: -1, doc: {} },
  });
  const workspace = new RouteWorkspace({
    registrations: [registration(), registration("instances"), registration("takeoffs")],
    store,
  });
  const read = (documents: unknown[] = []) =>
    readNavigation(workspace, { threads: async () => [], documents: async () => documents });
  const snapshot = await read([{ session: "s", openId: "unsaved", address: null }]);
  const row = (id: string) => snapshot.works.find((work) => work.id === id)!;
  expect(row(workKey(open)).url).toContain("/family?");
  expect(row(workKey(fixed)).url).toBe("/open");
  expect(row(workKey(arbitrary))).toMatchObject({
    url: null,
    reason: "This tool has no URL that resumes this named Work workspace.",
  });
  expect(row(workKey(broken))).toMatchObject({ state: "unreadable", url: null, revision: null });
  expect(row(workKey(retired))).toMatchObject({ state: "unregistered", url: null });
  expect((await read()).works.find((work) => work.id === workKey(open))!.url).toBeNull();
  // Save As changed the lifetime's binding: the former open-only Work cannot resume addressed Work.
  expect(
    (
      await read([
        { session: "s", openId: "unsaved", address: address("C:\\Models\\NowSaved.rvt") },
      ])
    ).works.find((work) => work.id === workKey(open))!.url,
  ).toBeNull();
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

test("oversized canonical files are reported without loading or changing their bytes", async () => {
  const directory = await temporary();
  const store = fileRouteDocumentStore(directory);
  const path = join(directory, `${"d".repeat(64)}.json`);
  const file = await open(path, "w");
  try {
    await file.truncate(17 * 1024 * 1024);
  } finally {
    await file.close();
  }
  const before = await stat(path);
  expect(await store.listState!()).toMatchObject({ records: [], unreadable: 1 });
  const after = await stat(path);
  expect(after.size).toBe(before.size);
  expect(after.mtimeMs).toBe(before.mtimeMs);
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
      head: { defaultTarget: null, revision: 0 },
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

test("failed owners remain explicit and do not turn registrations into instances", async () => {
  const getState = vi.fn(async () => null);
  const setState = vi.fn(async () => {});
  const workspace = new RouteWorkspace({
    registrations: [registration()],
    store: { getState, setState },
  });
  const snapshot = await readNavigation(workspace, {
    threads: async () => {
      throw Error("offline");
    },
    documents: async () => {
      throw Error("offline");
    },
  });
  expect(snapshot.works).toEqual([]);
  expect(snapshot.threads).toEqual([]);
  expect(snapshot.observations).toHaveLength(3);
  expect(getState).not.toHaveBeenCalled();
  expect(setState).not.toHaveBeenCalled();
});
