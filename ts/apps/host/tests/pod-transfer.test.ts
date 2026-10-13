/**
 * Host-local pod reads and archive transport over the production `/call` route. No Revit: the
 * bridge is a stub that fails the test if anything reaches it.
 */
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { HttpRouter } from "effect/unstable/http";
import type { Caller } from "@pe/agent-contracts";
import { documentsRootEnvVar } from "@pe/host-contracts/product-paths";
import { withInvocationContext } from "@pe/mcps/context";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { CaptureStore } from "../src/captures-route.ts";
import { listPackages } from "../src/packages.ts";
import { exportPod, importPod, writeZip } from "../src/pod-transfer.ts";
import { human } from "./callers.ts";

let root: string;
let pods: string;
let web: ReturnType<typeof HttpRouter.toWebHandler>;
const nativeCalls: string[] = [];
const previousDocuments = process.env[documentsRootEnvVar];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-pod-transfer-"));
  process.env[documentsRootEnvVar] = join(root, "Documents");
  pods = join(root, "Documents", "Pe.Tools", "Pods");
  const bridge = {
    list: Effect.succeed([]),
    invoke: (key: string) => {
      nativeCalls.push(key);
      return Effect.die(`native call ${key}`);
    },
  } as unknown as RevitBridge["Service"];
  web = HttpRouter.toWebHandler(
    makeCallRoute(
      new ActionJournal(join(root, "journal.json")),
      new TakeoffCaptures(join(root, "captures")),
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, bridge))),
    { disableLogger: true },
  );
});
afterEach(async () => {
  await web.dispose();
  if (previousDocuments === undefined) delete process.env[documentsRootEnvVar];
  else process.env[documentsRootEnvVar] = previousDocuments;
  nativeCalls.length = 0;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** A mutation crosses `/actions` as one exact admission against the host, the only write door. */
const act = async (key: string, input: unknown, as: Caller = human) => {
  const id = randomUUID();
  let row = (await post("/actions", { id, kind: "operation", key, destination: { kind: "host" }, input, bases: {} }, as)).json;
  for (let wait = 0; row.state === "running" && wait < 100; wait++) {
    await new Promise((settle) => setTimeout(settle, 20));
    const listed = await web.handler(new Request(`http://host/actions?id=${id}`), Context.empty() as never);
    row = ((await listed.json()) as Record<string, any>[])[0] ?? row;
  }
  return row;
};

const call = (key: string, request?: unknown, as: Caller = human) =>
  post("/call", request === undefined ? { key } : { key, request }, as);

const post = (path: string, body: unknown, as: Caller) =>
  withInvocationContext({ caller: as }, async () => {
    const response = await web.handler(
      new Request(`http://host${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      Context.empty() as never,
    );
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  });

async function writePod(folder: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(pods, folder, path, ".."), { recursive: true });
    await writeFile(join(pods, folder, path), content);
  }
}

const mixed = {
  "pod.json": JSON.stringify({
    schemaVersion: 2,
    id: "ducts",
    name: "Ducts",
    version: "1.0.0",
    entrypoints: [{ sourcePath: "src/Census.cs", name: "Census" }],
  }),
  "src/Census.cs": "public sealed class Census : PeScriptContainer { }",
  "pages/tour/index.html": "<title>Tour</title>",
  "pages/tour/.state/binding.json": '{"default":{}}',
  "settings/checks.json": "{}",
  "output/run-1/receipt.json": "{}",
};

test("pod.capture answers the admitted bundle by manifest id from a renamed folder, with no native call", async () => {
  await writePod("Renamed In Explorer", mixed);

  const captured = await call("pod.capture", { pod: "ducts" });

  expect(captured.status).toBe(200);
  expect(captured.json.folder).toBe("Renamed In Explorer");
  expect(captured.json.sourceBundle.files.map((f: { path: string }) => f.path).sort()).toEqual([
    "pages/tour/index.html",
    "pod.json",
    "settings/checks.json",
    "src/Census.cs",
  ]);
  expect(captured.json.contributions.map((c: { key: string }) => c.key).sort()).toEqual([
    "member:@ducts/settings/checks.json",
    "page:@ducts/pages/tour",
    "script:@ducts/src/Census.cs",
  ]);
  expect((await call("pod.capture", { pod: "missing" })).status).toBe(404);
  expect(nativeCalls).toEqual([]);
});

test("pod.list carries each pod's canonical contribution keys", async () => {
  await writePod("Renamed In Explorer", mixed);

  const listed = await call("pod.list");

  expect(listed.status).toBe(200);
  expect(
    listed.json.pods[0].contributions.map((c: { key: string }) => c.key).sort(),
  ).toEqual(["member:@ducts/settings/checks.json", "page:@ducts/pages/tour", "script:@ducts/src/Census.cs"]);
  expect(nativeCalls).toEqual([]);
});

/* ── Archive transport: host-only, zero native calls ──────────────────────────────────────── */

const machineProject = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><TargetFramework>net8.0-windows</TargetFramework></PropertyGroup>
  <ItemGroup>
    <Reference Include="Pe.Revit.Scripting"><HintPath>C:\\Users\\someone\\AppData\\Pe.Revit.Scripting.dll</HintPath><Private>false</Private></Reference>
  </ItemGroup>
  <ItemGroup><PackageReference Include="Humanizer" Version="2.14.1" /></ItemGroup>
  <ItemGroup><Using Include="My.Namespace" /></ItemGroup>
</Project>`;

async function shared(store: CaptureStore) {
  const png = Buffer.from("not really a png, but bytes with a hash");
  const kept = await store.keep(png, {
    origin: "human",
    document: { title: "Sample.rvt" },
    view: { name: "Level 1" },
    focus: null,
    registration: null,
  });
  await writePod("Global Library", {
    "pod.json": JSON.stringify({ schemaVersion: 2, id: "global", name: "Global", version: "1", entrypoints: [] }),
    "settings/_fields/Header.json": '{\n  "title": "header",\n  "$preset": "@local/_fields/Base"\n}',
    "settings/_fields/Base.json": '{ "base": true }',
  });
  await writePod("Renamed In Explorer", {
    ...mixed,
    "PeScripts.csproj": machineProject,
    "settings/checks.json": '{"$preset":"@global/_fields/Header","x":1}',
    "settings/leaf.json": '{ "untouched": true }',
    "pages/tour/.state/events.jsonl": `{"seq":1,"event":{"img":"/captures/${kept.sha}.png"}}\n`,
    "README.md": "# Ducts",
  });
  return kept.sha;
}

test("export vendors, ports the project, closes captures; import into a renamed folder elsewhere lands the same pod", async () => {
  const store = new CaptureStore(join(root, "store-a"));
  const sha = await shared(store);
  const archivePath = join(root, "out", "ducts.zip");

  const exported = await exportPod({ pod: "ducts", archivePath }, { podsRoot: pods, captures: store });

  expect(exported.vendored.map((v) => [v.id, v.path])).toEqual([
    ["global", "settings/_fields/Header.json"],
    ["global", "settings/_fields/Base.json"],
  ]);
  expect(exported.transforms.map((t) => [t.path, t.transform])).toEqual([
    ["PeScripts.csproj", "portable-project"],
    ["settings/checks.json", "vendor-references"],
  ]);
  expect(exported.captures).toEqual([sha]);
  const archived = exported.members.map((m) => m.path);
  expect(archived).toContain(`captures/${sha}.png`);
  expect(archived).toContain(`captures/${sha}.json`);
  expect(archived.filter((p) => /binding\.json|^output\/|imported\.json/.test(p))).toEqual([]);
  // Deterministic bytes: the same pod exports to the same archive hash.
  const again = await exportPod(
    { pod: "ducts", archivePath: join(root, "out", "again.zip") },
    { podsRoot: pods, captures: store },
  );
  expect(again.archiveSha256).toBe(exported.archiveSha256);

  const otherPods = join(root, "Other Machine", "Pods");
  const otherStore = new CaptureStore(join(root, "store-b"));
  const imported = await importPod(
    { archivePath, folder: "Other Name" },
    { podsRoot: otherPods, captures: otherStore },
  );
  const read = (path: string) => readFile(join(otherPods, "Other Name", path), "utf8");

  expect(imported.id).toBe("ducts");
  expect(imported.members.map((m) => m.path).sort()).toEqual([...archived].sort());
  expect(await read("settings/checks.json")).toContain(
    '"$preset": "@local/_vendor/global/_fields/Header.json"',
  );
  expect(await read("settings/_vendor/global/_fields/Header.json")).toContain(
    '"$preset": "@local/_vendor/global/_fields/Base.json"',
  );
  expect(await read("settings/_vendor/global/_fields/Base.json")).toBe('{ "base": true }');
  expect(await read("settings/leaf.json")).toBe('{ "untouched": true }');
  expect(await read("PeScripts.csproj")).not.toContain("HintPath");
  expect(await read("PeScripts.csproj")).toContain(
    '<PackageReference Include="Humanizer" Version="2.14.1" />',
  );
  expect(await read("PeScripts.csproj")).toContain('<Using Include="My.Namespace" />');
  expect(await read("pages/tour/.state/events.jsonl")).toContain(sha);
  await expect(read("pages/tour/.state/binding.json")).rejects.toThrow();
  expect(JSON.parse(await read("imported.json"))).toMatchObject({
    archiveSha256: exported.archiveSha256,
    locator: archivePath,
  });
  expect(await otherStore.blob(sha)).not.toBeNull();
  // An imported capture is an old observation: held by hash, never a new taking on this host.
  expect(await otherStore.list()).toEqual([]);
  const keys = (await listPackages(otherPods)).packages[0]!.contributions.map((c) => c.key);
  expect(keys).toEqual(
    expect.arrayContaining([
      "page:@ducts/pages/tour",
      "script:@ducts/src/Census.cs",
      "member:@ducts/settings/checks.json",
    ]),
  );

  await expect(
    importPod({ archivePath, folder: "Twice" }, { podsRoot: otherPods, captures: otherStore }),
  ).rejects.toThrow(/already installed in folder 'Other Name'/);
  expect(nativeCalls).toEqual([]);
});

test("a capture this host does not hold refuses export and writes nothing", async () => {
  const store = new CaptureStore(join(root, "store-a"));
  await shared(store);
  const archivePath = join(root, "out", "ducts.zip");

  await expect(
    exportPod(
      { pod: "ducts", archivePath },
      { podsRoot: pods, captures: new CaptureStore(join(root, "empty")) },
    ),
  ).rejects.toThrow(/names capture [0-9a-f]{64}, which this host does not hold/);
  await expect(readFile(archivePath)).rejects.toThrow();
});

test("pod.export and pod.import cross /actions with no session and no native call", async () => {
  await writePod("Renamed In Explorer", mixed);
  const archivePath = join(root, "ducts.zip");

  const exported = await act("pod.export", { pod: "ducts", archivePath });
  expect(exported).toMatchObject({ state: "succeeded" });
  expect(await act("pod.import", { archivePath })).toMatchObject({ state: "failed" });
  await rm(join(pods, "Renamed In Explorer"), { recursive: true });
  const imported = await act("pod.import", { archivePath });
  expect(imported).toMatchObject({ state: "succeeded" });
  expect(JSON.stringify(imported)).toContain('"folder":"ducts"');
  expect(await act("pod.import", { archivePath: "relative.zip" })).toMatchObject({ state: "failed" });
  expect(nativeCalls).toEqual([]);
});

const zip = (files: Record<string, string | Buffer>) =>
  writeZip(new Map(Object.entries(files).map(([path, v]) => [path, Buffer.from(v)])));
const manifest = JSON.stringify({ schemaVersion: 2, id: "evil", entrypoints: [] });

test.each([
  ["a host-owned binding", { "pod.json": manifest, "pages/p/.state/binding.json": "{}" }, /never carry 'pages\/p\/\.state\/binding\.json'/],
  ["import provenance", { "pod.json": manifest, "imported.json": "{}" }, /never carry 'imported\.json'/],
  ["runtime output", { "pod.json": manifest, "output/r/receipt.json": "{}" }, /never carry/],
  ["traversal", { "pod.json": manifest, "../outside.txt": "x" }, /Pod archive refused/],
  ["case twins", { "pod.json": manifest, "README.md": "a", "readme.md": "b" }, /case-colliding/],
  ["no manifest", { "README.md": "a" }, /must contain pod\.json/],
  ["a reserved id", { "pod.json": JSON.stringify({ id: "pages" }) }, /no valid, unreserved id/],
  ["an oversized entry", { "pod.json": manifest, "big.bin": Buffer.alloc(600 * 1024) }, /bytes per entry/],
] as const)("an archive with %s is refused and installs nothing", async (_, files, refusal) => {
  const archivePath = join(root, "evil.zip");
  await writeFile(archivePath, zip(files as Record<string, string | Buffer>));

  await expect(importPod({ archivePath }, { podsRoot: pods })).rejects.toThrow(refusal);
  expect((await listPackages(pods)).packages).toEqual([]);
});

test("an entry that inflates past its declared size is refused (decompression bomb)", async () => {
  const archive = zip({ "pod.json": manifest, "bomb.txt": Buffer.alloc(400 * 1024) });
  // Claim 10 bytes for bomb.txt in its central directory entry.
  const name = archive.lastIndexOf("bomb.txt");
  const entry = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), name);
  archive.writeUInt32LE(10, entry + 24);
  await writeFile(join(root, "bomb.zip"), archive);

  await expect(
    importPod({ archivePath: join(root, "bomb.zip") }, { podsRoot: pods }),
  ).rejects.toThrow(/does not inflate within its declared size/);
});

test("pod.promote wraps a scratch Page byte for byte, unbound, without touching the original", async () => {
  const pages = join(root, "Documents", "Pe.Tools", "Pages");
  const html = "<!doctype html><title>Notes</title><script src=/pages/pe.js></script>";
  await mkdir(join(pages, "notes", ".state"), { recursive: true });
  await writeFile(join(pages, "notes", "index.html"), html);
  await writeFile(join(pages, "notes", ".state", "events.jsonl"), '{"seq":1}\n');
  await writeFile(join(pages, "notes", ".state", "binding.json"), "{}");

  const promoted = await act("pod.promote", { page: "notes", id: "my-notes" });

  expect(promoted).toMatchObject({ state: "succeeded" });
  expect(JSON.stringify(promoted)).toContain('"key":"page:@my-notes/pages/notes"');
  const inPod = join(pods, "my-notes", "pages", "notes");
  expect(await readFile(join(inPod, "index.html"), "utf8")).toBe(html);
  expect(await readFile(join(inPod, ".state", "events.jsonl"), "utf8")).toBe('{"seq":1}\n');
  await expect(readFile(join(inPod, ".state", "binding.json"))).rejects.toThrow();
  expect(await readFile(join(pages, "notes", ".state", "binding.json"), "utf8")).toBe("{}");
  expect(JSON.stringify(await act("pod.promote", { page: "notes", id: "my-notes" }))).toContain("already installed");
  expect(JSON.stringify(await act("pod.promote", { page: "missing", id: "other" }))).toContain("No scratch Page");
  expect(nativeCalls).toEqual([]);
});
