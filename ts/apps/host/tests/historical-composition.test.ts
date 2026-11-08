import { sourceProvenanceSchema, type Caller, type WorkKey } from "@pe/agent-contracts";
import { HOST_RUNTIME_SERVICE_HEADER, HOST_RUNTIME_SERVICE_QUERY } from "@pe/host-contracts/contracts";
import { RouteWorkspace } from "@pe/runtime";
import { Context, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { nativeReadResolveEndpoint } from "../../../packages/agent-contracts/src/native-read-endpoint.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { readInputRoutes, hostInputGraph } from "../src/app.ts";
import { DuctFiles } from "../src/ducts-files.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { hostInputs, recordingInputSelection } from "../src/host-program.ts";
import { nativeCatalogIdentity, nativeInputIdentity, openRecordingWriter } from "../src/native-recording.ts";
import { admitBuild } from "../src/receipt-export.ts";
import { relaunchOutOfGuard } from "../src/redirection-trust.ts";
import { admittedRequestIdentity, readSchemas, RequestIdentity } from "../src/request-services.ts";
import { threadPointerPort } from "../src/thread-pointers.ts";
import { bootHost } from "./real-server.ts";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const stamp = admitBuild("host", { version: "1.0.0", build: "a".repeat(12), commit: "a".repeat(40) }, randomUUID(), randomUUID())!;
const identity = { build: JSON.stringify({ version: stamp.version, build: stamp.build, commit: stamp.commit }), catalog: nativeCatalogIdentity() };
const scope = { bridgeSessionId: "recorded-session" };
const human: Caller = { kind: "human", via: "local" };
const bounds = { maxBytes: 1_000_000, maxTakings: 100 };
const key = "host.ops.catalog";
const bundle = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-historical-composition-")); dirs.push(dir);
  const writer = await Effect.runPromise(openRecordingWriter(dir, identity, bounds));
  const schemas = await Effect.runPromise(readSchemas(key));
  const input = { input: { kind: "native" as const, key, args: "{}" }, scope: JSON.stringify(scope), outputVersion: schemas.version };
  const outcome = { kind: "answered" as const, value: { operations: [], constants: {} }, answer: {
    nativeRequestId: "recorded-native", actualTarget: { processIncarnation: { pid: 7, startedAt: 1000 }, openDocumentLifetime: { kind: "session-only" as const } },
    freshness: { freshnessGeneration: "recorded:g1" }, cost: {}, nativeOutcome: "committed" as const,
  } };
  // A /call consumes a recorded native.call graph, not an unowned taking.
  const append: typeof writer.append = (input, outcome) => Effect.gen(function* () {
    const taking = yield* writer.append(input, outcome);
    yield* writer.readSets.keep({
      version: 1, id: randomUUID(), identity,
      recipe: { key: "native.call", input: { key, input: {}, scope }, scope: JSON.stringify(scope) },
      state: "complete", inputs: [{ input: input.input, scope: input.scope, start: 0, takingId: taking.id }],
      children: [], takingLinks: {}, dependencies: {}, exports: [],
    });
    return taking;
  });
  const taking = await Effect.runPromise(append(input, outcome));
  return { dir, writer: { ...writer, append }, recording: writer, taking, input, outcome };
};
const router = async (dir: string, bindings?: ReadonlyMap<string, string>) => {
  const inputs = await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: dir, at: null, bindings }));
  let liveFactories = 0;
  const graph = hostInputGraph(inputs, () => { liveFactories++; return Layer.effectDiscard(Effect.die("Live graph was constructed")); }, () => readInputRoutes(inputs));
  const web = HttpRouter.toWebHandler(graph, { disableLogger: true });
  const send = (path: string, body?: unknown, caller: Caller = human, selectedScope = scope) => web.handler(new Request(`http://host${path}`, {
    method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), Context.make(RequestIdentity, admittedRequestIdentity(caller, selectedScope)));
  return { inputs, send, close: web.dispose, liveFactories: () => liveFactories };
};

test("existing native call and resolve replay with zero live graph; provenance is bounded", async () => {
  const { dir } = await bundle(); const app = await router(dir);
  try {
    expect(app.inputs.lane.kind).toBe("recording");
    if (app.inputs.lane.kind === "recording") expect("append" in app.inputs.lane.recordingStore).toBe(false);
    const answer = await app.send("/call", { key, request: {} });
    expect(answer.status, await answer.clone().text()).toBe(200);
    expect(await answer.json()).toEqual({ operations: [], constants: {} });
    expect(answer.headers.get("x-pe-native-request-id")).toBe("recorded-native");
    const resolved = await app.send(nativeReadResolveEndpoint.path, { operationKey: key, input: {} });
    expect(resolved.status, await resolved.clone().text()).toBe(200);
    expect(await resolved.json()).toMatchObject({ operationKey: key, processIncarnation: { pid: 7, startedAt: 1000 }, freshnessGeneration: "recorded:g1" });
    const features = await app.send("/pe/features");
    const source = features.headers.get("x-pe-source")!;
    expect(sourceProvenanceSchema.parse(JSON.parse(source))).toEqual({ kind: "recording", at: null, ...identity, coverage: ["native"] });
    expect(source).not.toMatch(/recordingStore|captureStore|directory|append|observations/);
    expect((await app.send("/call", { key }, { kind: "pea", context: "test-context", thread: "t1" })).status).toBe(200);
    expect(app.liveFactories()).toBe(0);
  } finally { await app.close(); }
});

test("actual caller, scope, coverage, unknown and missing input refuse without live fallback", async () => {
  const { dir } = await bundle(); const app = await router(dir);
  try {
    expect((await app.send("/call", { key }, { kind: "anonymous" })).status).toBe(403);
    expect((await app.send("/call", { key, unexpected: true })).status).toBe(400);
    expect((await app.send("/call", { key }, human, { bridgeSessionId: "today" })).status).toBe(409);
    for (const [path, body, problem] of [
      ["/call", { key: "settings.schema", request: { schemaUrl: "https://example.test/schema" } }, "recording.miss"],
      ["/call", { key: "unknown.operation" }, "read.contract"],
      ["/call", { key: "ducts.snapshot.walk", request: {} }, "recording.coverage"],
      ["/fans", undefined, "recording.coverage"],
      ["/pe/route-state", undefined, "recording.coverage"],
    ] as const) {
      const response = await app.send(path, body);
      expect(response.status, await response.clone().text()).toBe(409);
      expect(await response.text()).toContain(problem);
    }
    expect(app.liveFactories()).toBe(0);
  } finally { await app.close(); }
});

test("equal takings remain ambiguous until an exact root binding is supplied", async () => {
  const { dir, writer, taking, input, outcome } = await bundle();
  await Effect.runPromise(writer.append(input, outcome));
  const ambiguous = await router(dir);
  try { expect(await (await ambiguous.send("/call", { key })).text()).toContain("recording.ambiguous"); }
  finally { await ambiguous.close(); }
  const bound = await router(dir, new Map([[await Effect.runPromise(nativeInputIdentity({ key, input: {}, scope })), taking.id]]));
  try { expect((await bound.send("/call", { key })).status).toBe(200); expect(bound.liveFactories()).toBe(0); }
  finally { await bound.close(); }
});

test("native root bindings refuse foreign consumers, scopes, unknown takings and occurrence mismatches", async () => {
  for (const refusal of ["foreign-root", "cross-scope", "unknown-taking", "wrong-occurrence"] as const) {
    const { dir, recording, taking, input, outcome } = await bundle();
    const otherScope = { bridgeSessionId: "another-session" };
    const selectedScope = refusal === "cross-scope" ? otherScope : scope;
    const boundTaking = refusal === "unknown-taking" ? randomUUID()
      : (await Effect.runPromise(recording.append({ ...input, scope: JSON.stringify(selectedScope) }, outcome))).id;
    if (refusal !== "unknown-taking") {
      await Effect.runPromise(recording.readSets.keep({
        version: 1, id: randomUUID(), identity,
        recipe: { key: refusal === "foreign-root" ? "another.consumer" : "native.call",
          input: { key, input: {}, scope: selectedScope }, scope: JSON.stringify(selectedScope) },
        state: "complete", inputs: refusal === "wrong-occurrence"
          ? [{ input: input.input, scope: input.scope, start: 0, takingId: taking.id },
             { input: input.input, scope: input.scope, start: 1, takingId: boundTaking }]
          : [{ input: input.input, scope: JSON.stringify(selectedScope), start: 0, takingId: boundTaking }],
        children: [], takingLinks: {}, dependencies: {}, exports: [],
      }));
    }
    const app = await router(dir, new Map([[await Effect.runPromise(nativeInputIdentity({ key, input: {}, scope })), boundTaking]]));
    try {
      const response = await app.send("/call", { key });
      expect(response.status, refusal).toBe(409);
      expect(await response.text()).toContain(refusal === "wrong-occurrence" ? "recording.mismatch" : "recording.miss");
      expect(app.liveFactories()).toBe(0);
    } finally { await app.close(); }
  }
});

test("historical mutation doors refuse without append or any live graph", async () => {
  const { dir, writer } = await bundle(); const app = await router(dir);
  const before = await readdir(dir, { recursive: true });
  try {
    for (const [path, body] of [
      ["/call", { key: "ducts.apply", request: {} }],
      ["/call", { key: "scripting.execute", request: {} }],
      ["/call", { key: "revit.matrix.loaded-families", request: {} }],
      [nativeReadResolveEndpoint.path, { operationKey: "revit.matrix.loaded-families", input: {} }],
      ["/actions", { key: "families.apply.preview" }],
      ["/actions", { key: "ducts.apply-losses" }],
      ["/actions", { key: "ducts.plan-losses" }],
      ["/pe/route-state/fans/apply", { kind: "apply" }], ["/pe/route-state/fans/history", { direction: "undo" }],
      ["/call", { key: "pointers.point", request: {} }],
      ["/call", { key: "pointers.dismiss", request: {} }],
    ] as const) {
      const response = await app.send(path, body);
      expect(response.status, await response.clone().text()).toBe(409);
    }
    expect(await readdir(dir, { recursive: true })).toEqual(before);
    expect(writer.candidates(await Effect.runPromise(nativeInputIdentity({ key, input: {}, scope })))).toHaveLength(1);
    expect(app.liveFactories()).toBe(0);
  } finally { await app.close(); }
});

test("journal, Work and pointer owners refuse before storage or executor access", async () => {
  const { dir } = await bundle(); const inputs = await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: dir, at: null }));
  const journalPath = join(dir, "forbidden-journal.jsonl");
  const journal = new ActionJournal(journalPath, Date.now); journal.bindInputContext(inputs);
  // Policy precedes even envelope decoding: no malformed or resumed command can acquire current inputs.
  await expect(journal.invoke({ id: randomUUID(), key: "ducts.apply-losses", input: {}, target: { kind: "host" } }, { caller: human, basis: null })).rejects.toMatchObject({ problem: "recording.historical" });
  let storage = 0;
  const workspace = new RouteWorkspace({ registrations: [], store: { getState: async () => { storage++; return null; }, setState: async () => { storage++; } },
    authorizeMutation: (verb) => { const denied = inputs.check({ kind: "work", verb }); if (denied) throw denied; },
  });
  const work = { route: "/fans" } as WorkKey;
  for (const run of [
    () => workspace.apply(work, "/fans", "human", [], 0),
    () => workspace.step(work, "/fans", "human", "undo", 0),
    () => workspace.step(work, "/fans", "human", "redo", 0),
    () => workspace.publish(work, "/fans", [], 0),
  ]) await expect(Promise.resolve().then(async () => { await run(); })).rejects.toMatchObject({ problem: "recording.historical" });
  let mutations = 0; const pointers = threadPointerPort(inputs);
  pointers.bind({ read: () => ({ threadId: "t1", pointers: [] }), point: () => { mutations++; return { threadId: "t1", pointers: [] }; }, dismiss: () => { mutations++; return { threadId: "t1", pointers: [] }; } });
  expect(() => pointers.dismiss("t1", "p1")).toThrow();
  expect(() => pointers.point("t1", { route: "/fans", label: "fan", place: {} })).toThrow();
  expect(storage).toBe(0); expect(mutations).toBe(0);
  expect(await readdir(dir)).not.toContain("forbidden-journal.jsonl");
});

test("historical open creates nothing; identity and point gaps refuse; unrecorded live is explicit", async () => {
  const { dir } = await bundle(); const missing = join(dir, "missing");
  const failure = await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: missing, at: null }).pipe(Effect.flip));
  expect(failure.problem).toBe("recording.missing"); expect(await readdir(dir)).not.toContain("missing");
  expect((await Effect.runPromise(hostInputs(null, { kind: "recording", directory: dir, at: null }).pipe(Effect.flip))).problem).toBe("recording.identity");
  expect((await Effect.runPromise(hostInputs(null, { kind: "live", capture: "automatic" }).pipe(Effect.flip))).problem).toBe("recording.identity");
  expect((await Effect.runPromise(hostInputs(stamp, { kind: "recording", directory: dir, at: "point" }).pipe(Effect.flip))).problem).toBe("recording.point");
  const live = await Effect.runPromise(hostInputs(null, { kind: "live", capture: "off" }));
  expect(live.source).toEqual({ kind: "live", capturing: false });
  let built = 0; hostInputGraph(live, () => { built++; return Layer.empty; }, () => { throw Error("historical graph selected"); });
  expect(built).toBe(1);
});

test("historical entry serves real static files through identity and retains API refusals", async () => {
  const { dir } = await bundle();
  const webRoot = join(dir, "web"); await mkdir(join(webRoot, "assets"), { recursive: true });
  const html = '<!doctype html><title>recorded host</title><script src="/assets/app.js"></script>';
  await writeFile(join(webRoot, "index.html"), html); await writeFile(join(webRoot, "assets/app.js"), "export const recorded = true;");
  await writeFile(join(webRoot, "assets/app.css"), "body { color: navy; }");
  const selection = await Effect.runPromise(recordingInputSelection(["--recording", dir]));
  const inputs = await Effect.runPromise(hostInputs(stamp, selection!));
  let live = 0;
  const files = vi.spyOn(DuctFiles, "layer").mockImplementation(() => { live++; throw Error("live files"); });

  const host = await bootHost({ inputs, webRoot, revitCompositionFactory: () => { live++; throw Error("live composition"); } });
  const navigation = { accept: "text/html", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" };
  try {
    const page = await fetch(`${host.base}/fans`, { headers: navigation });
    expect(page.status, await page.clone().text()).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html"); expect(await page.text()).toBe(html);
    const cookie = page.headers.get("set-cookie")!; expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict");
    const headers = { cookie: cookie.split(";")[0]!, referer: `${host.base}/fans`, origin: host.base, "sec-fetch-site": "same-origin",
      [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName };
    for (const [asset, body, type] of [["app.js", "export const recorded = true;", "javascript"], ["app.css", "body { color: navy; }", "text/css"]]) {
      const response = await fetch(`${host.base}/assets/${asset}`, { headers: { ...headers, "sec-fetch-dest": asset.endsWith("css") ? "style" : "script" } });
      expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain(type); expect(await response.text()).toBe(body);
    }
    expect((await fetch(`${host.base}/pe/features`, { headers })).status).toBe(200);
    const malformed = await fetch(`${host.base}/assets/%`, { headers: { ...headers, accept: "text/html" } });
    expect(malformed.status).toBe(403); expect(await malformed.text()).toContain("identity.path");
    for (const path of ["/pe/unknown", "/pe/unknown.js", "/assets/x%2f..%2f..%2fpe%2funknown", "/pe/environment", "/admin/unknown", "/host/status", "/unknown"]) {
      const response = await fetch(host.base + path, { headers: { ...headers, accept: "text/html" } });
      expect(response.status, path).toBe(409); expect(response.headers.get("content-type")).not.toContain("text/html");
      expect(await response.text()).toContain("recording.coverage");
    }
    const mutation = await fetch(`${host.base}/actions`, { method: "POST", headers, body: "{}" });
    expect(mutation.status).toBe(409); expect(mutation.headers.get("content-type")).not.toContain("text/html");
    expect((await fetch(`${host.base}/assets/app.js`, { method: "POST", headers, body: "{}" })).status).toBe(409);
    expect((await fetch(`${host.base}/pe/threads`, { method: "POST", headers, body: "{}" })).status).toBe(409);
    const { cookie: omitted, ...anonymous } = headers;
    expect((await fetch(`${host.base}/pe/threads`, { method: "POST", headers: anonymous, body: "{}" })).status).toBe(403);
    const noncanonical = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${host.base}/pe/features`, { headers: { ...headers, host: "noncanonical.example" } }, (response) => {
        response.resume(); response.on("end", () => resolve(response.statusCode!));
      });
      request.on("error", reject); request.end();
    });
    expect(noncanonical).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${host.base}/pe/features`, { headers: { ...headers, [HOST_RUNTIME_SERVICE_HEADER]: "wrong-owner" } })).status).toBe(403);
    expect((await fetch(`${host.base}/pe/features`, { headers: { ...headers, origin: "https://wrong.example" } })).status).toBe(403);
    const connection = randomUUID(); const abort = new AbortController();
    const stream = await fetch(`${host.base}/pe/resources?connection=${connection}&${HOST_RUNTIME_SERVICE_QUERY}=${hostOwnership.serviceName}`, { headers, signal: abort.signal });
    expect(stream.status).toBe(200); const read = stream.body!.getReader();
    try {
      expect(new TextDecoder().decode((await read.read()).value)).toBe(": open\n\n");
      const update = await fetch(`${host.base}/pe/resource-subscriptions?connection=${connection}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ add: [{ kind: "inventory" }], remove: [] }) });
      expect(update.status).toBe(200);
      expect(new TextDecoder().decode((await read.read()).value)).toContain("recording.miss");
    } finally { await read.cancel(); abort.abort(); }
    expect(live).toBe(0);
    await mkdir(join(import.meta.dirname, "../../../../.artifacts/runs/kernel-crusade-20261104/step-7"), { recursive: true });
    await writeFile(join(import.meta.dirname, "../../../../.artifacts/runs/kernel-crusade-20261104/step-7/host-entry-http-receipt.json"), JSON.stringify({
      selection, stampOrigin: "existing historical-composition TEST fixture; no baked artifact/process claim", identity,
      navigation: { status: page.status, contentType: page.headers.get("content-type"), httpOnly: cookie.includes("HttpOnly"), sameSiteStrict: cookie.includes("SameSite=Strict") },
      assets: ["app.js", "app.css"], noncanonicalStatus: noncanonical, liveFactories: live, ordinaryProcessLaunch: "UNPROVEN", webGate: "unimplemented; /pe/environment still409",
    }, null, 2));
  } finally { await host.close(); files.mockRestore(); }
  for (const missingRoot of [null, join(dir, "missing-web")]) {
    const absent = await bootHost({ inputs, webRoot: missingRoot });
    try {
      const response = await fetch(`${absent.base}/fans`, { headers: navigation });
      expect(response.status).toBe(503); expect(await response.text()).toContain("unavailable");
      expect((await fetch(`${absent.base}/pe/features`)).status).toBe(200);
    } finally { await absent.close(); }
  }
}, 60000);

test("recording process selection is strict and cannot enter the source live fallback", async () => {
  expect(await Effect.runPromise(recordingInputSelection(["--open", "--no-revit", "--take-over-host"]))).toBeUndefined();
  const { dir } = await bundle();
  let entered = 0;
  for (const [runtime, prefix] of [["node", [process.execPath, "host/index.js"]], ["sea", ["Pe.Host.exe", "Pe.Host.exe"]]] as const) {
    const launch = vi.fn();
    for (const [index, args] of [["--recording", dir], ["--recording"], ["--open"]].entries()) {
      const request = { trust: "enforced" as const, argv: [...prefix, ...args], exe: prefix[0],
        marker: join(dir, `guard-${runtime}-${index}.stamp`), launch, log: () => {} };
      expect(relaunchOutOfGuard(request)).toBe(false);
    }
    expect(launch).not.toHaveBeenCalled();
    const startup = { trust: "enforced" as const, argv: prefix, exe: prefix[0],
      marker: join(dir, `guard-${runtime}-default.stamp`), launch, log: () => {} };
    expect(relaunchOutOfGuard(startup)).toBe(true);
    expect(relaunchOutOfGuard(startup)).toBe(false);
    expect(launch).toHaveBeenCalledExactlyOnceWith(prefix[0]);
    expect(await Effect.runPromise(recordingInputSelection(prefix))).toBeUndefined();
    const selected = await Effect.runPromise(recordingInputSelection([...prefix, "--open", "--recording", dir, "--no-revit"]));
    expect(selected).toEqual({ kind: "recording", directory: dir, at: null });
    expect(await Effect.runPromise(hostInputs(null, selected!).pipe(Effect.flip))).toMatchObject({ problem: "recording.identity" });
    for (const args of [["--recording"], ["--recording", ""], ["--recording", "  "], ["--recording", "--open"],
      ["--recording=x"], ["--recording", dir, "--take-over-host"], ["--Recording", dir], ["--recordings", dir], ["--recording", dir, "--recording", dir], ["--recording", "\0"]]) {
      const failed = await Effect.runPromise(recordingInputSelection([...prefix, ...args]).pipe(Effect.tap(() => Effect.sync(() => { entered++; })), Effect.flip));
      expect(failed).toMatchObject({ problem: "recording.argument", status: 400 });
    }
  }
  expect(entered).toBe(0);
});
