// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { waitFor } from "@testing-library/react";
import { memberWork } from "@pe/agent-contracts";
import { createRouteOwner, makeAtomRegistry } from "#/route/route-owner";
import {
  createReadingGraph,
  type ReadingContext,
  type ReadingSource,
  type ReadingState,
  type UseSource,
} from "#/shell/readings";
import { invoke, commit, type Caller, type VerbContext } from "#/shell/verbs";
import { podsSources } from "./sources";
import { podsPageSchema } from "./page";
import { podsGraph } from "./graph";
import { podsBinding, podsTransition } from "./actions";
import { PodsHostFixture } from "./host.fixture";

let host: PodsHostFixture;
const cleanups: (() => void)[] = [];
beforeEach(() => {
  host = new PodsHostFixture();
  vi.stubGlobal("fetch", host.fetch);
  vi.stubGlobal("EventSource", host.source());
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
});
const ready = (value: unknown): ReadingState => ({
  value,
  status: "ready",
  current: true,
  complete: true,
  basis: null,
  version: 1,
});
function environment() {
  let page = podsPageSchema.parse({ ...host.member, member: memberWork(host.member) });
  const readings: Record<string, ReadingState> = {};
  const sources = podsSources();
  const scope = () => ({
    target: { kind: "host" as const },
    workKey: host.key,
    workRevision: host.revision,
    page,
    work: host.doc,
  });
  async function read(id: string) {
    const decl = podsGraph.readings[id]!;
    const source = sources[decl.source] as UseSource;
    const context: ReadingContext = {
      ...scope(),
      attempt: { target: { kind: "host" }, workKey: host.key, generation: 1 },
      trigger: { kind: "demand" },
      args: decl.args?.(page),
      inputs: readings,
      signal: new AbortController().signal,
    };
    await source.open(context, (publication) => {
      if (publication.kind === "failure") throw publication.error;
      if (publication.kind === "complete") readings[id] = ready(publication.value);
    });
    return readings[id]?.value;
  }
  const registry = makeAtomRegistry();
  const owner = createRouteOwner("pods-verbs-proof", registry);
  cleanups.push(() => {
    owner.dispose();
    registry.dispose();
  });
  const snapshot = () => ({
    target: { kind: "host" as const },
    work: { handle: { key: host.key, revision: host.revision }, doc: host.doc },
    basis: host.revision,
  });
  const human: VerbContext<"human"> = {
    caller: "human",
    owner,
    snapshot,
    subjects: {},
    page: () => page,
    readings: () => readings,
    write: (_, request) => host.write({ ...request, kind: "apply" }),
  };
  const agent: VerbContext<"agent"> = {
    ...human,
    caller: "agent",
  };
  const ctx = <C extends Caller>(caller: C): VerbContext<C> =>
    (caller === "human" ? human : agent) as VerbContext<C>;
  async function run(id: string, row?: unknown, caller: Caller = "human") {
    const binding = podsBinding(id, row, { ...snapshot(), page, readings });
    const result = await invoke(ctx(caller), podsGraph.verbs[id]!, binding.subject, binding.args);
    if (result.state === "done" && result.kind === "page")
      page = { ...page, ...podsTransition(page, result.page).patch };
    return result;
  }
  return { read, run, readings, scope, ctx, page: () => page, sources };
}

test("host adapters read inventory, exact bytes, composition, scoped runs and activation", async () => {
  const env = environment();
  expect(await env.read("pods")).toEqual(host.pods);
  expect(await env.read("member")).toMatchObject({
    member: host.member,
    content: host.raw,
    sha256: host.sha256,
  });
  expect(await env.read("composition")).toMatchObject({
    member: host.member,
    draft: host.raw,
    result: { schemaValidation: "passed" },
  });
  await env.read("runs");
  expect(host.calls.at(-1)).toEqual({ key: "pod.runs", request: host.member });
  await env.read("plugins");
  expect(env.readings.plugins!.value).toMatchObject({
    statuses: [{ id: `pod:${host.member.pod}`, status: "active" }],
  });
  expect(host.actions).toEqual([]);
});

test("the member edit verb returns the host inverse and settings.write consumes its exact revision", async () => {
  const env = environment();
  await env.read("member");
  const before = structuredClone(host.doc);
  const edited = await env.run("edit", { content: '{"width":4}' });
  expect(edited).toMatchObject({
    state: "done",
    kind: "work",
    acknowledgement: { key: host.key, base: 1, revision: 2, undoable: true },
  });
  expect(host.doc.fields[""]?.edit?.value).toBe('{"width":4}');
  const ack = host.writes[0]!;
  await host.write({
    kind: "restore",
    press: "undo-proof",
    expectedRevision: host.revision,
    patches: ack.inverse,
  });
  expect(host.doc).toEqual(before);
  await env.run("edit", { content: '{"width":4}' });
  await env.read("composition");
  const saved = await env.run("save");
  expect(saved).toMatchObject({ state: "done", kind: "command" });
  expect(host.actions[0]!.input).toMatchObject({ work: { key: host.key, revision: 4 } });
  expect(host.actions[0]!.key).toBe("settings.write");
  expect(host.raw).toBe('{"width":4}');
  expect(host.doc.fields).toEqual({});
});

test("an uncommitted editor buffer cannot save older Work edits", async () => {
  const env = environment();
  await env.read("member");
  await env.run("edit", { content: '{"width":2}' });
  await env.read("composition");
  const scope = {
    ...env.scope(),
    work: { handle: { key: host.key, revision: host.revision }, doc: host.doc },
    page: { ...env.page(), pendingDraft: true },
    readings: env.readings,
  };
  expect(podsBinding("save", undefined, scope).args).toMatchObject({
    refusal: expect.stringContaining("still being edited"),
  });
  expect(podsBinding("save-new", undefined, scope).args).toMatchObject({
    refusal: expect.stringContaining("still being edited"),
  });
});

test("mounted reading demand recomposes only the new Work candidate after an edit", async () => {
  const env = environment();
  const graph = createReadingGraph(podsGraph, {
    sources: env.sources,
    scope: env.scope(),
    log: () => {},
  });
  cleanups.push(() => graph.dispose());
  const release = graph.mount(["composition"]);
  cleanups.push(release);
  await waitFor(() => expect(graph.get("composition").current).toBe(true));
  env.readings.member = graph.get("member");
  await env.run("edit", { content: '{"width":6}' });
  graph.update(env.scope());
  await waitFor(() =>
    expect(graph.get("composition").value).toMatchObject({ draft: '{"width":6}' }),
  );
  expect(
    host.calls
      .filter((call) => call.key === "pod.member.compose")
      .map((call) => call.request.content),
  ).toEqual([host.raw, '{"width":6}']);
});

test("fixture and plain source reads preserve their lanes without host calls", async () => {
  const env = environment();
  const page = podsPageSchema.parse({ demo: "browse" });
  const read = async (id: string) => {
    const source = env.sources[podsGraph.readings[id]!.source] as UseSource;
    const publications: unknown[] = [];
    await source.open(
      {
        ...env.scope(),
        page,
        inputs: {},
        args: null,
        attempt: { target: { kind: "host" }, workKey: null, generation: 1 },
        signal: new AbortController().signal,
        trigger: { kind: "demand" },
      },
      (publication) => publications.push(publication),
    );
    return publications;
  };
  await read("pods");
  await read("member");
  await read("composition");
  await read("runs");
  await read("plugins");
  expect(host.calls).toEqual([]);
  expect(host.actions).toEqual([]);
  await env.run("select", { pod: host.member.pod, path: "src/tool.cs" });
  expect(env.page().member).toBe("");
  expect(await env.read("member")).toBeNull();
  expect(host.calls).toEqual([]);
});

test("validation follows exact draft bytes and rejects malformed or host-invalid saves", async () => {
  const env = environment();
  await env.read("member");
  await env.read("composition");
  await env.run("edit", { content: '{"width":2}' });
  expect(await env.run("save")).toMatchObject({ state: "refused" });
  host.invalid = true;
  await env.read("composition");
  expect(await env.run("save")).toMatchObject({
    state: "refused",
    refusal: { message: expect.stringContaining("Width is invalid") },
  });
  expect(await env.run("save-new")).toMatchObject({ state: "refused" });
  await env.run("edit", { content: "{ invalid raw" });
  expect(await env.read("composition")).toBeNull();
  expect(await env.run("save")).toMatchObject({
    state: "refused",
    refusal: { message: expect.stringContaining("JSON") },
  });
  expect(host.actions).toEqual([]);
});

test("adopting changed disk bytes requires a shown review; a new member remains create-only", async () => {
  const env = environment();
  await env.read("member");
  await env.run("edit", { content: '{"width":2}' });
  host.moveDisk();
  await env.read("member");
  expect(await env.run("edit", { content: '{"width":3}' })).toMatchObject({ state: "refused" });
  const review = await env.run("adopt");
  expect(review.state).toBe("review");
  expect(host.actions).toEqual([]);
  if (review.state !== "review") throw Error("Missing review");
  expect(await commit(env.ctx("human"), podsGraph.verbs.adopt!, review.ticket)).toMatchObject({
    state: "done",
  });
  expect(host.doc.fields).toEqual({});
  expect(host.doc.basis!.sha256).toBe(host.sha256);
  await env.run("edit", { content: '{"width":8}' });
  await env.read("composition");
  const saved = await env.run("save-new");
  expect(saved.state, JSON.stringify(saved)).toBe("done");
  expect(saved).toMatchObject({
    state: "done",
    kind: "command",
    page: { pod: host.member.pod, path: expect.stringMatching(/^settings\/model\..+\.json$/) },
  });
  expect(host.actions[1]!.input).toMatchObject({
    destination: { pod: host.member.pod },
    work: { key: host.key },
  });
  expect(host.doc.fields[""]?.edit?.value).toBe('{"width":8}');
});

test("selection couples Work to the member and activation refuses Pea", async () => {
  const env = environment();
  await env.run("select", host.other);
  expect(env.page()).toMatchObject({ ...host.other, member: memberWork(host.other) });
  await env.read("plugins");
  expect(
    await env.run("activation", { id: `pod:${host.member.pod}`, enabled: false }, "agent"),
  ).toMatchObject({ state: "refused" });
  expect(host.activations).toEqual([]);
  expect(
    await env.run("activation", { id: `pod:${host.member.pod}`, enabled: false }),
  ).toMatchObject({ state: "done", kind: "rpc" });
  expect(host.activations).toEqual([{ enabled: false }]);
});

test("the reading graph fences a delayed old member through A to B to A", async () => {
  const env = environment();
  let deliver: Parameters<UseSource["open"]>[1] | undefined;
  const source: ReadingSource = {
    kind: "use",
    open: (_, publish) => {
      deliver = publish;
    },
  };
  const graph = createReadingGraph(
    { readings: { member: podsGraph.readings.member! } },
    {
      sources: { "pods.member": source },
      scope: env.scope(),
      log: () => {},
    },
  );
  cleanups.push(() => graph.dispose());
  const release = graph.mount(["member"]);
  cleanups.push(release);
  const first = deliver!;
  await env.run("select", host.other);
  graph.update(env.scope());
  await env.run("select", host.member);
  graph.update(env.scope());
  first({ kind: "complete", revision: 99, value: { content: "obsolete bytes" } });
  expect(graph.get("member").value).toBeUndefined();
  deliver!({ kind: "complete", revision: 1, value: { content: "current bytes" } });
  expect(graph.get("member").value).toEqual({ content: "current bytes" });
});
