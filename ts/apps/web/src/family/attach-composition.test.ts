import { uploadBlob } from "../../../../packages/mcps/src/shared/blob-client.ts";
import { put as putBlob } from "../../../host/src/action-blobs.ts";
import { serveRoutes } from "../../../host/tests/real-server.ts";
import { mintContext } from "../../../host/src/control.ts";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { capturedWorkReads, workReadContext } from "../../../host/src/work-inputs.ts";
import { HostInputReadSets } from "../../../host/src/input-occurrence.ts";
import { nativeCatalogIdentity, openRecordingWriter } from "../../../host/src/native-recording.ts";
import type { CommandResources } from "../../../host/src/command-executor.ts";
// @vitest-environment node
import { test, expect, vi } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { NodeServices } from "../../../host/tests/family-attach-host.fixture.ts";
import { RouteWorkspace, observeResources } from "@pe/runtime";
import { bindWork, canonicalRouteInput, familyDraftRouteState, READING_MAX_FRAME_BYTES } from "@pe/agent-contracts";
import { module } from "./route";
import { mountTypedRoute } from "../shell/typed-mount.ts";
import { createWorkFeedClient } from "../shell/work-feed-client.ts";
import { admittedBuiltinsLayer, AdmittedBuiltins } from "../../../host/src/admitted-builtins.ts";
import { Scope, Exit } from "effect";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store.ts";
import { familySpecExecutor } from "../../../host/src/family-spec.ts";
import { commandResources } from "../../../host/src/command-reads.ts";
import { ActionIncomplete } from "../../../host/src/action-journal.ts";
import { ActionJournal } from "../../../host/src/action-journal.ts";
import { makeCallRoute } from "../../../host/src/call-route.ts";
import { SdkDriver } from "../../../host/src/sdk-session.ts";
import { hostResourceObserver } from "../../../host/src/resource-adapters.ts";
import { detachedBridge, testHostInputs } from "../../../host/tests/effect-test.ts";
import { bindActionReadings, type Readings } from "../host/resource-stream";
import { submitAction, recoverAction } from "../../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { withInvocationContext, readOutbox } from "@pe/runtime/context";

// Real typed declaration, command client, HTTP handler, journal, Work and receipt projection.
// A real socket drives production action reconciliation. PDF parsing and the unused native bridge are substitutes.
test("Start publishes Family Work before immediate small attach and 7 MB refusal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-attach-"));
  const member = { pod: "test", path: "settings/family/HCB.json" };
  const scope = Scope.makeUnsafe();
  const writer = await Effect.runPromise(openRecordingWriter(join(dir, "history"), {build: "surface", catalog: nativeCatalogIdentity()}, {maxBytes: 10_000_000, maxTakings: 1000}));
  const lane = {kind: "live" as const, captureStore: writer};
  const sets = Context.get(await Effect.runPromise(Layer.buildWithScope(HostInputReadSets.layer(lane), scope)), HostInputReadSets);
  const work = new RouteWorkspace({ registrations: [], store: fileRouteDocumentStore(join(dir, "work")), capture: capturedWorkReads(writer, Effect.runPromise) });
  const workReads: NonNullable<CommandResources["workReads"]> = admission => {
    const read = async (method: "read" | "view", key: Parameters<RouteWorkspace["read"]>[0], route: string) => {
      const current = await Effect.runPromise(sets.open({key: `command.work.${method}`, input: JSON.parse(JSON.stringify({id: admission.id, command: admission.key, key, route})), scope: JSON.stringify(admission.target)}, null));
      try {
        const value = await work[method](key, route, workReadContext(current, Effect.runPromise));
        await Effect.runPromise(current.seal);
        return value;
      } finally { await Effect.runPromise(current.close); }
    };
    return {read: (key, route) => read("read", key, route), view: (key, route) => read("view", key, route)};
  };
  const admitted = await Effect.runPromise(Layer.buildWithScope(admittedBuiltinsLayer(work), scope));
  const fingerprint = Context.get(admitted, AdmittedBuiltins).routes.get("family")!.workFingerprint;
  const journal = new ActionJournal(join(dir, "journal.jsonl"), Date.now);
  const bridge = detachedBridge();
  const parsed = {jobId: "small", fileName: "small.pdf", pages: [], blocks: [], images: []};
  const parsePdf = vi.fn(async () => parsed)
    .mockRejectedValue(Error("PDF parser refused this source")).mockResolvedValueOnce(parsed);
  await mkdir(join(dir, member.pod, "settings/family"), { recursive: true });
  await writeFile(join(dir, member.pod, "pod.json"), JSON.stringify({id: member.pod}));
  await writeFile(join(dir, member.pod, member.path), JSON.stringify({ family: { name: "HCB" } }));
  const pdf = join(dir, "source.pdf");
  await writeFile(pdf, "%PDF-" + "x".repeat(7 * 1024 * 1024));
  const web = await serveRoutes(makeCallRoute(journal, undefined, { workspace: work, workReads, podsRoot: dir, parsePdf }).pipe(
    Layer.provide(testHostInputs), Layer.provide(NodeServices.layer),
  ), bridge, Layer.succeed(SdkDriver, () => Effect.die("No native access")));
  const nativeFetch = globalThis.fetch;
  const token = mintContext({kind: "human", via: "cli"});
  const caller = { kind: "human" as const, via: "local" as const };
  const outboxes: ReturnType<typeof readOutbox>[] = [];
  const request = (url: any, init?: RequestInit) => {
    if (init?.method === "POST" && new URL(String(url), "http://localhost").pathname === "/actions") {
      const admission = JSON.parse(String(init.body));
      if(admission.key === "family.attach-spec") outboxes.push(readOutbox(`pe-action::${admission.id}:${canonicalRouteInput(null)}`));
    }
    return nativeFetch(new URL(String(url), web.base), {...init, headers: {...Object.fromEntries(new Headers(init?.headers)), [HOST_CONTEXT_HEADER]: token}});
  };
  const feed = await Effect.runPromise(sets.open({key: "surface.work-feed", input: {}, scope: "host"}, null));
  const observe = observeResources(work, undefined, hostResourceObserver(bridge, () => journal), workReadContext(feed, Effect.runPromise));
  const frames: unknown[] = [];
  const readings = { subscribe: (request: any, deliver: any) => observe(request, frame => {
    frames.push(frame);
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(READING_MAX_FRAME_BYTES);
    deliver(frame);
  }), dirty() {} } as unknown as Readings;
  vi.stubGlobal("window", {location: {origin: web.base}});
  const stop = bindActionReadings(readings);
  vi.stubGlobal("fetch", request);
  const door = createWorkFeedClient(readings, { submit: command => withInvocationContext({caller}, () => submitAction(command)), write: async () => { throw Error("No cell write"); } });
  const search = new URLSearchParams({pod: JSON.stringify(member.pod), path: JSON.stringify(member.path)});
  const mount = mountTypedRoute(module, { address: {read: () => search, write() {}, subscribe: () => () => {}},
    target: {kind: "host"}, work: {address: null, open: null}, fixture: null, custody: {current: () => true}, memory: () => ({}) },
    fingerprint, {work: door});
  let startReturnHandle: unknown = null;
  try {
    await vi.waitFor(() => expect(mount.startAction()).not.toBeNull());
    expect(mount.owner()?.handle).toBeNull();
    await mount.startAction()!.run();
    startReturnHandle = mount.owner()?.handle ?? null;
    await expect(mount.run("attach", false, {member, source: await uploadBlob({fileName: "small.pdf", base64: Buffer.from("%PDF-1.4\nsmall manufacturer source\n%%EOF").toString("base64")})})).resolves.toMatchObject({member, pages: 0});
    expect((await journal.list()).find(row=>row.key === "work.start")).toMatchObject({state: "succeeded", result: {revision: 1}});
    const attached = (await journal.list()).find(row=>row.key === "family.attach-spec")!;
    expect(attached).toMatchObject({state: "succeeded", input: {work: {revision: 1}}});
    expect((await work.read(bindWork("family", null), "family", workReadContext(feed, Effect.runPromise)))?.doc).toMatchObject({spec: {member, doc: {jobId: "small"}}});
    expect(JSON.parse(await readFile(join(dir, member.pod, `${member.path}.spec.json`), "utf8"))).toMatchObject({path: "settings/family/small-small.json"});
    await vi.waitFor(() => expect(mount.owner()?.handle?.revision).toBe(2));
    const run = mount.run("attach", false, {member, source: await uploadBlob({fileName: "source.pdf", base64: (await readFile(pdf)).toString("base64")})});
    await expect(run).rejects.toThrow("PDF parser refused this source");
    expect(mount.reviewProblem("attach")).toContain("PDF parser refused this source");
    const receipt = (await journal.list()).find(row=>row.key === "family.attach-spec" && row.state === "failed")!;
    await expect(recoverAction(receipt.id, "family.attach-spec", {
      ...receipt.input, source: {...(receipt.input.source as object), fileName: "another.pdf"},
    }, receipt.target)).rejects.toThrow("conflicts with its original intent");
    expect(JSON.stringify(receipt)).not.toMatch(/"(?:base64|bytesBase64)"/);
    expect(JSON.stringify(frames)).not.toMatch(/"(?:base64|bytesBase64)"/);
    expect(await readFile(join(dir, "journal.jsonl"), "utf8")).not.toMatch(/"(?:base64|bytesBase64)"/);
    expect(outboxes[1]?.admission?.input.source).toMatchObject({fileName: "source.pdf", size: 7 * 1024 * 1024 + 5});
    expect(JSON.stringify(outboxes[1]).length).toBeLessThan(1024);
    expect(parsePdf).toHaveBeenCalledTimes(2);
    expect(writer.capture.truncated(), "History survives Start, attach publication and failed attach").toBeNull();
    expect(writer.capture.begin()).not.toBeNull();
    expect(frames.length).toBeGreaterThan(0);
  } finally {
    if(process.env.PE_START_ATTACH_EVIDENCE) await writeFile(process.env.PE_START_ATTACH_EVIDENCE, JSON.stringify({startReturnHandle, stored: await work.read(bindWork("family", null), "family", workReadContext(feed, Effect.runPromise)), truncated: writer.capture.truncated(), receipts: await journal.list()}, null, 2));
    mount.dispose(); stop(); await Effect.runPromise(feed.seal); await Effect.runPromise(feed.close); vi.unstubAllGlobals(); await journal.close(); await web.close(); await Effect.runPromise(Scope.close(scope, Exit.void)); await rm(dir, {recursive: true, force: true});
  }
});


test("resume reads prepared Family assets by digest without parsing again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-attach-resume-"));
  const member = {pod: "test", path: "settings/family/HCB.json"};
  const key = bindWork("family", null);
  const work = new RouteWorkspace({registrations: [{spec: familyDraftRouteState}], store: fileRouteDocumentStore(join(dir, "work"))});
  const bridge = detachedBridge();
  const parsePdf = vi.fn(async () => ({jobId: "retained", fileName: "source.pdf", pages: [], blocks: [], images: []}));
  const deps = {workspace: work, podsRoot: dir, parsePdf};
  await mkdir(join(dir, member.pod, "settings/family"), {recursive: true});
  await writeFile(join(dir, member.pod, "pod.json"), JSON.stringify({id: member.pod}));
  await writeFile(join(dir, member.pod, member.path), JSON.stringify({family: {name: "HCB"}}));
  const pdf = join(dir, "source.pdf");
  await writeFile(pdf, "%PDF-retained");
  const executor = familySpecExecutor(deps);
  const path = join(dir, "journal.jsonl");
  let stopAfterPrepare = true;
  const open = () => {
    const journal = new ActionJournal(path, Date.now);
    journal.bindCommands({...commandResources(bridge, deps, async id => (await journal.list(undefined, id))[0]),
      resolve: () => ({...executor, run: async (ctx, execution) => {
        return executor.run(ctx, {...execution, step: async (...args) => {
          const result = await execution.step(...args);
          if (stopAfterPrepare) { stopAfterPrepare = false; throw new ActionIncomplete("Interrupted after first prepared asset", null); }
          return result;
        }});
      }})});
    return journal;
  };
  let journal = open();
  try {
    const view = (await work.view(key, "family"))!;
    const crossing = {caller: {kind: "human" as const, via: "local" as const}, basis: {kind: "human" as const}};
    await journal.invoke({id: "resume", key: "family.attach-spec", target: {kind: "host"}, input: {member, source: await putBlob(await readFile(pdf), "source.pdf"), work: {key, revision: view.revision}}}, crossing);
    const prepared = await journal.wait("resume");
    expect(prepared.state, JSON.stringify(prepared)).toBe("incomplete");
    await journal.close();
    journal = open();
    await journal.resume("resume", crossing);
    expect((await journal.wait("resume")).state).toBe("succeeded");
    expect(parsePdf).toHaveBeenCalledOnce();
    expect(await readFile(join(dir, member.pod, "settings/family/source-retained/source.pdf"), "utf8")).toBe("%PDF-retained");
    expect(await readFile(path, "utf8")).not.toMatch(/"(?:base64|bytesBase64)"/);
  } finally { await journal.close(); await rm(dir, {recursive: true, force: true}); }
});
