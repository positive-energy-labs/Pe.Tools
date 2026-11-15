import { afterEach, expect, test, vi } from "vite-plus/test";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { peDo, peRead } from "../src/pea/capability-tools.ts";
import { fakeRuntimeHost } from "./runtime-host-fixture.ts";
import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { createHash } from "node:crypto";
import { scriptSourceRevision } from "@pe/host-contracts/script-revision";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// Mutants: drop the dispatched openId; bypass the no-target refusal; ignore the Page binding;
// drop receiptTarget's openId. Each must fail through the actual Pea door, not a resolver helper.
test.each(["read", "do"])("%s names the non-active lifetime in the request and receipt, and defaults only from a Page", async (door) => {
  const tool = door === "read" ? peRead : peDo;
  fakeRuntimeHost("http://127.0.0.1:9");
  vi.stubEnv("PE_CONTEXT", "test-context");
  const key = "script:@demo/src/Run.cs";
  const ref = { session: "s", openId: "brodie-lifetime" };
  const operations = hostOpCatalog.filter((op) => op.key === "scripting.execute");
  let helperVersion = 1;
  const bundle = (version: number) => ({ files: [
    { path: "src/Run.cs", bytesBase64: Buffer.from("Result(Helper.V);").toString("base64") },
    { path: "src/Helper.cs", bytesBase64: Buffer.from(`class Helper { const int V=${version}; }`).toString("base64") },
    { path: "pod.json", bytesBase64: Buffer.from('{"id":"demo"}').toString("base64") },
  ] });
  const members = (value: ReturnType<typeof bundle>) => value.files.map(file => ({ path: file.path,
    sha256: createHash("sha256").update(Buffer.from(file.bytesBase64, "base64")).digest("hex"), sizeBytes: 1 }));
  const originalBundle = bundle(1), originalRevision = scriptSourceRevision(members(originalBundle));
  const capabilities = buildCapabilities({ ops: operations, routes: [], skills: [], packages: [{
    id: "demo", folder: "demo", diagnostics: [],
    members: [...members(originalBundle), { path: "pages/compare/index.html", sha256: "a".repeat(64), sizeBytes: 1 }],
    contributions: [
      { key, sourcePath: "src/Run.cs", title: "Run", description: "", mode: "ReadOnly" },
      { key: "page:@demo/pages/compare", sourcePath: "pages/compare/index.html", title: "Compare", description: "", projection: { openUrl: "/pages/demo--compare/", pane: "page" } },
    ],
  }] });
  const admitted: Record<string, unknown>[] = [];
  let pageResolved = true;
  let corruptRevision = false;
  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === "/pe/scope/self") return Response.json({ thread: "t", revision: 1,
      targets: [{ request: { kind: "open", ref: { session: "s", openId: "chadds-lifetime" } }, admission: { revision: 1, at: new Date().toISOString(), via: "local" } }] });
    if (url.pathname === "/pe/capabilities") return Response.json({ at: new Date().toISOString(), machine: machineFixture(), sources: {}, diagnostics: [], capabilities });
    if (url.pathname === "/pe/contributions") {
      const pin = url.searchParams.get("sha256");
      const sourceBundle = pin === originalRevision ? originalBundle : bundle(helperVersion);
      const sha256 = scriptSourceRevision(members(sourceBundle));
      if (pin && pin !== sha256) return Response.json({ error: "revision unavailable" }, { status: 409 });
      return Response.json({ sha256: corruptRevision ? originalRevision : sha256, folder: "demo", sourceBundle });
    }
    if (url.pathname === "/ops") return Response.json({ operations, bridgeSessionId: "s" });
    if (url.pathname === "/call") return Response.json({ sessions: [{ sessionId: "s", connected: true, openDocuments: [
      { openId: "chadds-lifetime", title: "Chadds", isActive: true, isFamilyDocument: false },
      { openId: ref.openId, title: "Brodie", isActive: false, isFamilyDocument: false },
    ] }] });
    if (url.pathname === "/pages/demo--compare/target") return Response.json({
      page: "page:@demo/pages/compare", slot: "default", binding: { kind: "pinned", ref },
      resolution: pageResolved ? { kind: "resolved", target: { kind: "document", ref } } : { kind: "choose", reason: "document-closed" }, document: { ...ref, title: "Brodie" }, write: { kind: "pea" },
    });
    if (url.pathname === "/pages/demo--compare/events") return Response.json({ seq: 1 });
    if (url.pathname === "/actions") {
      if (request.method === "GET") return Response.json([]);
      const body = await request.json() as Record<string, unknown>;
      admitted.push(body);
      return Response.json({ ...body, caller: { kind: "human", via: "local" }, basis: null,
        state: "succeeded", result: { status: "Succeeded", data: { title: "Brodie" } },
        steps: [], prepared: { state: "unprepared" }, recovery: [], startedAt: new Date().toISOString() });
    }
    throw Error(`Unexpected request ${url}`);
  });
  const run = (extra: Record<string, unknown>) => tool.execute({ key, timeoutSeconds: 30, ...extra }, undefined);
  const refused = await run({});
  expect(refused).toMatchObject({ ok: false, content: expect.stringMatching(/Open documents: Chadds .*Brodie /) });
  expect(admitted).toHaveLength(0);
  const exact = await run({ target: { kind: "open", ref } });
  expect(exact).toMatchObject({ ok: true, target: { session: "s", openId: ref.openId } });
  expect(exact).toHaveProperty("target", { session: "s", openId: ref.openId });
  expect(admitted.at(-1)).toMatchObject({ target: { kind: "document", ref } });
  if (door === "do") expect(await peDo.execute({ key: "page:@demo/pages/compare", input: { event: { type: "note" } }, timeoutSeconds: 30 }, undefined))
    .toMatchObject({ ok: true, target: { session: "s", openId: ref.openId } });
  const bound = await run({ page: "page:@demo/pages/compare" });
  expect(bound, JSON.stringify(bound)).toMatchObject({ ok: true, target: { session: "s", openId: ref.openId } });
  expect(admitted.at(-1)).toMatchObject({ target: { kind: "document", ref } });
  helperVersion = 2;
  const fresh = await run({ target: { kind: "open", ref } });
  expect(fresh).toMatchObject({ ok: true, package: { sha256: scriptSourceRevision(members(bundle(2))) } });
  expect(admitted.at(-1)).toMatchObject({ input: { sourceBundle: bundle(2) } });
  corruptRevision = true;
  const beforeCorrupt = admitted.length;
  expect(await run({ target: { kind: "open", ref } })).toMatchObject({ ok: false, content: expect.stringContaining("revision unavailable") });
  expect(admitted).toHaveLength(beforeCorrupt);
  corruptRevision = false;
  pageResolved = false;
  const count = admitted.length;
  expect(await run({ page: "page:@demo/pages/compare" })).toMatchObject({ ok: false, content: expect.stringContaining("document-closed") });
  expect(admitted).toHaveLength(count);
});
