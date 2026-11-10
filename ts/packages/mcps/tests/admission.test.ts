import { machineFixture } from "../../agent-contracts/tests/machine-fixture.ts";
import { withInvocationContext } from "@pe/runtime/context";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { peDo, peRead } from "../src/pea/capability-tools.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { readAction } from "../src/shared/takeoff-action-client.ts";
import type { HostOperationDefinition } from "@pe/host-contracts/contracts";
import { bodyText } from "./body-text.ts";

const operations: HostOperationDefinition[] = [
  {subject:"None",touches:"Metadata",effect:"Read",cardinality:"One",costTier:"Cheap", key: "scripting.execute", intent: "Mutate", needs: "document" },
  {subject:"None",touches:"Metadata",effect:"Read",cardinality:"One",costTier:"Cheap", key: "scripting.workspace.bootstrap", intent: "Mutate", needs: "nothing" },
  {subject:"None",touches:"Metadata",effect:"Read",cardinality:"One",costTier:"Cheap", key: "pod.import", intent: "Mutate", needs: "nothing" },
  {subject:"None",touches:"Metadata",effect:"Read",cardinality:"One",costTier:"Cheap", key: "pod.export", intent: "Mutate", needs: "nothing" },
  {subject:"None",touches:"Metadata",effect:"Read",cardinality:"One",costTier:"Cheap", key: "revit.context.summary", intent: "Read", needs: "document" },
];
const target = { kind: "open", ref: { session: "A", openId: "open-A" } } as const;
const destination = { kind: "document", ref: target.ref };
const receipt = (admission: Record<string, unknown>) => {
  return {
    ...admission,
    caller: { kind: "pea", context: "c", thread: "t" },
    basis: null,
    state: "succeeded",
    result: { done: true },
    steps: [],
    prepared: { state: "unprepared" },
    recovery: [],
    startedAt: new Date(0).toISOString(),
  };
};

function host(prior?: Record<string, unknown>, scriptResponse?: Record<string, unknown>) {
  const posts: Record<string, unknown>[] = [];
  const reads: string[] = [];
  let saved: Record<string, unknown> | undefined;
  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    reads.push(url.pathname);
    if (url.pathname === "/actions") {
      if (init?.method !== "POST")
        return Response.json(prior ? [prior] : scriptResponse && saved ? [saved] : []);
      const body = JSON.parse(await bodyText(init));
      posts.push(body);
      if (prior) return Response.json(prior);
      saved = receipt(body);
      if (scriptResponse && body.key === "scripting.execute") {
        saved.result = scriptResponse;
        saved.prepared = { state: "ready", value: { sourceBundle: "s".repeat(5000) } };
      }
      return Response.json(saved);
    }
    if (prior) throw Error("Replay must not consult a live catalog or target");
    if (url.pathname === "/pe/capabilities")
      return Response.json({
        at: new Date(0).toISOString(),
        sources: {},
        diagnostics: [],
        machine: machineFixture(),
        capabilities: buildCapabilities({ ops: operations, routes: [], packages: [], skills: [] }),
      });
    if (url.pathname === "/ops") return Response.json({ operations, bridgeSessionId: "A" });
    if (url.pathname === "/call") {
      const body = JSON.parse(await bodyText(init));
      if (body.key === "bridge.sessions.list")
        return Response.json({
          sessions: [
            {
              sessionId: "A",
              connected: true,
              openDocuments: [{ openId: "open-A", address: "C:/A.rvt", isFamilyDocument: false }],
            },
          ],
        });
      if (body.key === "revit.context.summary") return Response.json({ title: "A" });
      throw Error(`Raw mutation on /call: ${body.key}`);
    }
    throw Error(`Unexpected ${url.href}`);
  });
  return { posts, reads };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const call = (tool: typeof peDo | typeof peRead, input: Record<string, unknown>, id = "attempt") =>
  withInvocationContext({ hostBaseUrl: "http://admission.test" }, () =>
    tool.execute!(
      { timeoutSeconds: 30, ...input } as never,
      { agent: { toolCallId: id } } as never,
    ),
  ) as Promise<Record<string, unknown>>;

test("pe_do returns a succeeded script's output once and points to its complete receipt", async () => {
  const scriptResponse = {
    status: "Succeeded",
    output: "x".repeat(8000),
    data: { answer: 42 },
    diagnostics: [
      { stage: "resolve", severity: "Info", message: "reference resolved".repeat(200) },
      { stage: "compile", severity: "Warning", message: "Exact warning" },
    ],
  };
  host(undefined, scriptResponse);
  const output = await call(peDo, {
    key: "op:scripting.execute",
    target,
    input: { scriptContent: "x" },
  });
  expect(output).toMatchObject({
    ok: true,
    result: {
      ok: true,
      response: {
        output: scriptResponse.output,
        data: scriptResponse.data,
        diagnostics: scriptResponse.diagnostics.slice(1),
        diagnosticCounts: { resolve: 1, compile: 1 },
      },
      action: { id: "attempt", state: "succeeded" },
      fullReceipt: { key: "op:action.read", input: { id: "attempt" } },
    },
  });
  expect(JSON.stringify(output).length).toBeLessThan(16_000);
  expect(JSON.stringify(output)).not.toContain("sourceBundle");
  expect(JSON.stringify(output)).not.toContain("reference resolved");
  const original = await readAction("attempt", "http://admission.test");
  expect(original).toMatchObject({
    state: "succeeded",
    result: scriptResponse,
    prepared: { state: "ready", value: { sourceBundle: "s".repeat(5000) } },
  });
});

test("a failed script keeps its whole result, resolve diagnostics included", async () => {
  const scriptResponse = {
    status: "CompilationFailed",
    output: "partial output",
    diagnostics: [{ stage: "resolve", severity: "Info", message: "Needed reference detail" }],
  };
  host(undefined, scriptResponse);
  const output = await call(peDo, {
    key: "op:scripting.execute",
    target,
    input: { scriptContent: "x" },
  });
  expect((output.result as Record<string, unknown>).response).toEqual(scriptResponse);
});

test("pe_do admits native and semantic commands with exact Work intent and no actor", async () => {
  const { posts } = host();
  expect(
    await call(peDo, { key: "op:scripting.execute", target, input: { scriptContent: "x" } }),
  ).toMatchObject({ ok: true });
  for (const key of ["scripting.workspace.bootstrap", "pod.import", "pod.export"]) {
    const result = await call(
      peDo,
      {
        key: `op:${key}`,
        ...(key === "scripting.workspace.bootstrap" ? { target: { id: "A" } } : {}),
      },
      key,
    );
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
  }
  const work = {
    key: { binding: "workspace", route: "takeoffs", target: null, work: "reviewed" },
    revision: 13,
  };
  expect(
    await call(peDo, {
      key: "op:takeoffs.partition",
      actionId: "partition",
      target,
      input: { work },
    }),
  ).toMatchObject({ ok: true });
  expect(posts).toMatchObject([
    {
      id: "attempt",
      key: "scripting.execute",
      target: destination,
      input: { scriptContent: "x" },
    },
    ...["scripting.workspace.bootstrap", "pod.import", "pod.export"].map((key) => ({
      id: key,
      key,
      target:
        key === "scripting.workspace.bootstrap"
          ? { kind: "session", session: "A" }
          : { kind: "host" },
    })),
    {
      id: "partition",
      key: "takeoffs.partition",
      target: destination,
      input: { work },
    },
  ]);
  expect(posts.at(-1)?.input).not.toHaveProperty("bases");
  for (const post of posts) expect(post).not.toHaveProperty("actor");
});

test("pe_read refuses mutations; pe_do refuses unknown and missing or closed targets before admission", async () => {
  const { posts } = host();
  expect(await call(peRead, { key: "op:scripting.execute", target })).toMatchObject({
    isError: true,
    content: expect.stringContaining("pe_do"),
  });
  for (const input of [
    { key: "op:missing", target },
    { key: "op:scripting.execute" },
    {
      key: "op:scripting.execute",
      target: { kind: "open", ref: { session: "A", openId: "closed" } },
    },
  ])
    expect(await call(peDo, input)).toMatchObject({ isError: true });
  expect(posts).toEqual([]);
  expect(await call(peRead, { key: "op:revit.context.summary", target })).toMatchObject({
    ok: true,
    result: { title: "A" },
  });
  expect(posts).toEqual([]);
});

test("pe_do replays the original receipt without catalog or target discovery and refuses changed intent or destination", async () => {
  const { posts, reads } = host(
    receipt({
      id: "attempt",
      key: "scripting.execute",
      target: destination,
      input: { scriptContent: "x" },
    }),
  );
  expect(
    await call(peDo, { key: "op:scripting.execute", input: { scriptContent: "x" } }),
  ).toMatchObject({ ok: true });
  expect(posts).toEqual([]);
  expect(
    await call(peDo, { key: "op:scripting.execute", input: { scriptContent: "changed" } }),
  ).toMatchObject({ isError: true, content: expect.stringContaining("conflicts") });
  expect(
    await call(peDo, {
      key: "op:scripting.execute",
      input: { scriptContent: "x" },
      target: { kind: "open", ref: { session: "B", openId: "open-B" } },
    }),
  ).toMatchObject({ isError: true, content: expect.stringContaining("target") });
  expect(posts).toHaveLength(0);
  expect(new Set(reads)).toEqual(new Set(["/actions"]));
});

test("pe_do admits a lifecycle action at the session its input names, with no head lifetime", async () => {
  const { posts } = host();
  const session = {
    selection: { id: "dev" },
    process: { pid: 7, processStartUtc: "2026-10-13T00:00:00.0000000Z", executable: "Revit.exe" },
  };
  expect(
    await call(peDo, {
      key: "op:instances.stop",
      input: { session, unsaved: "keep" },
      actionId: "stop",
    }),
  ).toMatchObject({ ok: true });
  expect(posts).toMatchObject([
    {
      id: "stop",
      key: "instances.stop",
      target: { kind: "sdk-session", selection: { id: "dev" } },
    },
  ]);
});

test("semantic recovery normalizes declared defaults before reading a later thread or closed document", async () => {
  const selected = {
    work: {
      key: {
        binding: "open",
        route: "takeoffs",
        target: null,
        open: { session: "A", openId: "open-A" },
      },
      revision: 13,
    },
  };
  const original = receipt({
    id: "old-sync",
    key: "takeoffs.sync",
    target: destination,
    input: selected,
  });
  const { posts, reads } = host(original);
  const recover = (input: Record<string, unknown>, override?: unknown) =>
    withInvocationContext(
      { hostBaseUrl: "http://admission.test", headers: { "x-pe-context": "later-turn" } },
      () =>
        peDo.execute!(
          {
            key: "op:takeoffs.sync",
            actionId: "old-sync",
            input,
            target: override,
            timeoutSeconds: 30,
          } as never,
          { agent: { toolCallId: "new-call" } },
        ),
    );
  expect(await recover(selected)).toMatchObject({
    ok: true,
    target: { session: "A" },
    result: { id: "old-sync" },
  });
  expect(await recover({ ...selected, work: { ...selected.work, revision: 14 } })).toMatchObject({
    isError: true,
    content: expect.stringContaining("conflicts"),
  });
  expect(
    await recover(selected, { kind: "open", ref: { session: "B", openId: "open-B" } }),
  ).toMatchObject({ isError: true, content: expect.stringContaining("target") });
  expect(posts).toEqual([]);
  expect(new Set(reads)).toEqual(new Set(["/actions"]));
});

test("a canonical script replays its captured manifest identity and sourcePath without a current folder lookup", async () => {
  const sourceBundle = {
    files: [
      { path: "pod.json", bytesBase64: Buffer.from('{"id":"shelf-test"}').toString("base64") },
      { path: "src/Census.cs", bytesBase64: Buffer.from("sealed script").toString("base64") },
    ],
  };
  const prior = receipt({
    id: "attempt",
    key: "scripting.execute",
    target: destination,
    input: { workspaceKey: "historical-folder", sourcePath: "src/Census.cs", sourceBundle },
  });
  const before = JSON.stringify(prior);
  const { posts, reads } = host(prior);
  expect(await call(peDo, { key: "script:@shelf-test/src/Census.cs" })).toMatchObject({ ok: true });
  expect(posts).toEqual([]);
  await expect(call(peDo, { key: "script:@other/src/Census.cs" })).rejects.toThrow("conflicts");
  await expect(call(peDo, { key: "script:@shelf-test/src/Other.cs" })).rejects.toThrow("conflicts");
  expect(posts).toHaveLength(0);
  expect(new Set(reads)).toEqual(new Set(["/actions"]));
  expect(JSON.stringify(prior)).toBe(before);
});

test("a direct RPC caller recovers its original command before consulting a missing catalogue", async () => {
  const { HostRpcCaller } = await import("../src/shared/host-rpc-caller.ts");
  const input = { pod: "p", archivePath: "p.zip" };
  const prior = receipt({ id: "rpc-original", key: "pod.export", target: { kind: "host" }, input });
  const { posts, reads } = host(prior);
  const caller = new HostRpcCaller({
    hostBaseUrl: "http://admission.test",
    requestId: "rpc-original",
  });
  expect(await caller.callOperation("pod.export", input)).toMatchObject({
    ok: true,
    response: { done: true },
    action: { id: "rpc-original" },
  });
  expect(posts).toEqual([]);
  expect(reads).toEqual(["/actions"]);
});


import { runCapability } from "../src/shared/admission.ts";
import { ductsDocumentSchema, fansDocumentSchema, workHandle } from "@pe/agent-contracts";
test.each(["open", "address", "workspace", "host"] as const)("loss preview reads exact %s ducts and fans Work before submission", async binding => {
 for (const scoped of [false, true]) {
  const posts: unknown[] = [];
  const key = binding === "address" ? {route: "ducts", binding, target: "C:/Models/A.rvt"}
    : binding === "open" ? {route: "ducts", binding, target: null, open: target.ref}
    : binding === "workspace" ? {route: "ducts", binding, target: null, work: "draft"}
    : {route: "ducts", binding, target: null};
  const work = { key, revision: 3 };
  vi.stubGlobal("fetch", async (input: Request | string | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/pe/route-state/ducts" || url.pathname === "/pe/route-state/fans") {
      const expected = binding === "address" ? {target: "C:/Models/A.rvt"}
        : binding === "open" ? {open: "A/open-A"}
        : binding === "workspace" ? {work: "draft"} : {};
      expect(Object.fromEntries(url.searchParams)).toEqual(expected);
      // The fan walk lives in fans Work at the same document key (the host derive reads it there).
      return Response.json(url.pathname.endsWith("/fans")
        ? {revision: 5, handle: workHandle({...key, route: "fans"} as never, 5), doc: fansDocumentSchema.parse(scoped ? {writeIntent: {edit: {value: {walk: {unitId: 14577391, portIndex: 0}}}}} : {})}
        : {revision: 3, handle: workHandle(key as never, 3), doc: ductsDocumentSchema.parse({})});
    }
    if (url.pathname === "/actions" && init?.method === "POST") {
      const body = JSON.parse(String(init.body)); posts.push(body);
      return Response.json(receipt(body));
    }
    throw Error(`Unexpected ${url.pathname}`);
  });
  const run = () => runCapability("sheet.plan", {work}, {hostBaseUrl: "http://preflight.test", receipt: true, bridgeSessionId: "A", openDocumentId: "open-A"}, {door: "command", mutates: false, needs: "project-document"});
  if (scoped) {
    expect(await run()).toMatchObject({state: "succeeded"});
    expect(posts).toHaveLength(1);
  } else {
    await expect(run()).rejects.toThrow("Preview needs a fan walk. Read route:reads.value (read fans.roster)");
    await expect(run()).rejects.not.toThrow("ducts.analysis");
    expect(posts).toEqual([]);
  }
 }
});
test("loss preview refuses a non-ducts Work handle before any read or submission", async () => {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (input: Request | string | URL) => {
    seen.push(new URL(input instanceof Request ? input.url : String(input)).pathname);
    throw Error("no request expected");
  });
  const work = { key: {route: "fans", binding: "host", target: null}, revision: 1 };
  await expect(runCapability("sheet.plan", {work}, {hostBaseUrl: "http://preflight.test", receipt: true}, {door: "command", mutates: false, needs: "project-document"}))
    .rejects.toThrow("Expected the route:ducts Work handle");
  expect(seen).toEqual([]);
});
