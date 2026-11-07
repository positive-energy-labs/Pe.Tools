// @vitest-environment node
import { test, expect, vi } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Effect, Layer } from "effect";
import { NodeServices, NodeHttpClient } from "../../../host/tests/family-attach-host.fixture.ts";
import { HttpRouter } from "effect/http";
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
import { nativeReadRoot } from "../../../host/src/app.ts";
import { RevitBridge } from "../../../host/src/bridge.ts";
import { SdkDriver } from "../../../host/src/sdk-session.ts";
import { RequestIdentity, admittedRequestIdentity } from "../../../host/src/request-services.ts";
import { hostResourceObserver } from "../../../host/src/resource-adapters.ts";
import { detachedBridge, testHostInputs } from "../../../host/tests/effect-test.ts";
import { bindActionReadings, type Readings } from "../readings";
import { submitAction, recoverAction } from "../../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { withInvocationContext, readOutbox } from "@pe/runtime/context";

// Real typed declaration, command client, HTTP handler, journal, Work and receipt projection.
// No socket listens. Only PDF parsing and the unused native bridge are substitutes.
test("7 MB upload refusal reaches the typed Family action reason", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-attach-"));
  const member = { pod: "test", path: "settings/family/HCB.json" };
  const work = new RouteWorkspace({ registrations: [], store: fileRouteDocumentStore(join(dir, "work")) });
  const scope = Scope.makeUnsafe();
  const admitted = await Effect.runPromise(Layer.buildWithScope(admittedBuiltinsLayer(work), scope));
  const fingerprint = Context.get(admitted, AdmittedBuiltins).routes.get("family")!.workFingerprint;
  const journal = new ActionJournal(join(dir, "journal.jsonl"), Date.now);
  const bridge = detachedBridge();
  const parsePdf = vi.fn(async () => {
    throw Error("PDF parser refused this source");
  });
  await mkdir(join(dir, member.pod, "settings/family"), { recursive: true });
  await writeFile(join(dir, member.pod, "pod.json"), JSON.stringify({id: member.pod}));
  await writeFile(join(dir, member.pod, member.path), JSON.stringify({ family: { name: "HCB" } }));
  const pdf = join(dir, "source.pdf");
  await writeFile(pdf, "%PDF-" + "x".repeat(7 * 1024 * 1024));
  const web = HttpRouter.toWebHandler(makeCallRoute(journal, undefined, { workspace: work, podsRoot: dir, parsePdf }).pipe(
    nativeReadRoot(Layer.succeed(SdkDriver, () => Effect.die("No native access"))),
    Layer.provide(testHostInputs), Layer.provideMerge(Layer.mergeAll(Layer.succeed(RevitBridge, bridge), NodeServices.layer, NodeHttpClient.layerUndici)),
  ), { disableLogger: true });
  const caller = { kind: "human" as const, via: "local" as const };
  const outboxes: ReturnType<typeof readOutbox>[] = [];
  const request = (url: any, init?: RequestInit) => {
    if (init?.method === "POST" && new URL(String(url), "http://localhost").pathname === "/actions") {
      const admission = JSON.parse(String(init.body));
      outboxes.push(readOutbox(`pe-action::${admission.id}:${canonicalRouteInput(null)}`));
    }
    return withInvocationContext({caller}, () => web.handler(new Request(new URL(String(url), "http://localhost"), init),
    Context.make(RequestIdentity, admittedRequestIdentity(caller, {}))));
  };
  const observe = observeResources(work, undefined, hostResourceObserver(bridge, () => journal));
  const frames: unknown[] = [];
  const readings = { subscribe: (request: any, deliver: any) => observe(request, frame => {
    frames.push(frame);
    expect(Buffer.byteLength(JSON.stringify(frame))).toBeLessThan(READING_MAX_FRAME_BYTES);
    deliver(frame);
  }), dirty() {} } as unknown as Readings;
  vi.stubGlobal("window", {location: {origin: "http://localhost"}});
  const stop = bindActionReadings(readings);
  vi.stubGlobal("fetch", request);
  const door = createWorkFeedClient(readings, { submit: command => withInvocationContext({caller}, () => submitAction(command)), write: async () => { throw Error("No cell write"); } });
  const search = new URLSearchParams({pod: JSON.stringify(member.pod), path: JSON.stringify(member.path)});
  const mount = mountTypedRoute(module, { address: {read: () => search, write() {}, subscribe: () => () => {}},
    target: {kind: "host"}, work: {address: null, open: null}, fixture: null, custody: {current: () => true}, memory: () => ({}) },
    fingerprint, {work: door});
  try {
    await vi.waitFor(() => expect(mount.owner()?.handle).toBeTruthy());
    const run = mount.run("attach", false, {member, source: {fileName: "source.pdf", base64: (await readFile(pdf)).toString("base64")}});
    await expect(run).rejects.toThrow("PDF parser refused this source");
    expect(mount.reviewProblem("attach")).toContain("PDF parser refused this source");
    const receipt = (await journal.list())[0]!;
    await expect(recoverAction(receipt.id, "family.attach-spec", {
      ...receipt.input, source: {...(receipt.input.source as object), fileName: "another.pdf"},
    }, receipt.target)).rejects.toThrow("conflicts with its original intent");
    expect(JSON.stringify(receipt)).not.toMatch(/"(?:base64|bytesBase64)"/);
    expect(JSON.stringify(frames)).not.toMatch(/"(?:base64|bytesBase64)"/);
    expect(await readFile(join(dir, "journal.jsonl"), "utf8")).not.toMatch(/"(?:base64|bytesBase64)"/);
    expect(outboxes[0]?.admission?.input.source).toMatchObject({fileName: "source.pdf", size: 7 * 1024 * 1024 + 5});
    expect(JSON.stringify(outboxes[0]).length).toBeLessThan(1024);
    expect(parsePdf).toHaveBeenCalledOnce();
    expect(frames.length).toBeGreaterThan(0);
  } finally { mount.dispose(); stop(); vi.unstubAllGlobals(); await journal.close(); await web.dispose(); await Effect.runPromise(Scope.close(scope, Exit.void)); await rm(dir, {recursive: true, force: true}); }
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
    await journal.invoke({id: "resume", key: "family.attach-spec", target: {kind: "host"}, input: {member, source: {path: pdf}, work: {key, revision: view.revision}}}, crossing);
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
