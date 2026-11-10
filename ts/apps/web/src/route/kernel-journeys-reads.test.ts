import { elementSubject } from "@pe/ducts-domain/work-subject";
import { stableFanKey } from "../ducts/sheet/model";
import { systemCode } from "../ducts/identity";
import { expect, test, vi } from "vite-plus/test";
import { fileURLToPath } from "node:url";
import retiredReads from "../../../../tests/repo-guards/src/retired-read-aliases.forbidden.json";

test("JZ Ducts chooser search box does not move across recorded Reading settlement", async () => {
  const [{ createServer }, { default: tailwind }, { openBrowser }] = await Promise.all([
    import("vite-plus"), import("@tailwindcss/vite"), import("@pe/browser"),
  ]);
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const server = await createServer({ configFile: false, root, plugins: [tailwind() as never],
    define: { __PE_WEB_RECEIPT_BUILD__: JSON.stringify({ version: "fixture", build: "layout", commit: "source" }) },
    resolve: { alias: { "#": root + "/src" }, dedupe: ["react", "react-dom"] },
    server: { host: "127.0.0.1", port: 0 },
  });
  let browser: Awaited<ReturnType<typeof openBrowser>> | undefined;
  try {
    await server.listen();
    browser = await openBrowser({ mode: "headless", args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
    const page = await browser.page();
    const errors: unknown[] = [];
    page.subscribe(event => { if (event.method === "Runtime.exceptionThrown") errors.push(event.params); });
    await page.send("Runtime.enable");
    await page.send("Network.enable");
    await page.send("Network.setBlockedURLs", { urls: ["https://fonts.googleapis.com/*", "https://fonts.gstatic.com/*"] });
    await page.send("Page.navigate", { url: server.resolvedUrls!.local[0] + "src/route/ducts-chooser-layout.fixture.html" });
    await vi.waitFor(async () => {
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => !!document.querySelector('input[aria-label="Search systems"]'))).toBe(true);
    }, { timeout: 10_000 });
    const measure = () => page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const input = document.querySelector<HTMLInputElement>('input[aria-label="Search systems"]')!;
      const { x, y, width, height } = input.getBoundingClientRect();
      return { x, y, width, height, reading: !!document.querySelector('[data-startup]'), connected: input.isConnected,
        statuses: Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).map(n => ({ text: n.textContent, y: n.getBoundingClientRect().y, height: n.getBoundingClientRect().height })) };
    });
    const before = await measure();
    expect(before).toMatchObject({ reading: true, connected: true });
    expect(before.width).toBeGreaterThan(0);
    expect(before.height).toBeGreaterThan(0);
    await page.evaluate(() => { (window as any).settleChooser(); return null; });
    await vi.waitFor(async () => expect((await measure()).reading).toBe(false));
    const after = await measure();
    expect(errors).toEqual([]);
    const shift = { x: after.x - before.x, y: after.y - before.y, width: after.width - before.width, height: after.height - before.height };
    console.log("Ducts chooser layout (CSS px)", JSON.stringify({ before, after, shift }));
    if (process.env.PE_CHOOSER_LAYOUT_RECEIPT) await writeFile(process.env.PE_CHOOSER_LAYOUT_RECEIPT, JSON.stringify({ before, after, shift }, null, 2));
    expect(shift).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  } finally { await browser?.close(); await server.close(); }
});
import { z } from "zod";
import { observeResources } from "@pe/runtime";
import { workFingerprintSchema, actionReceiptSchema } from "@pe/agent-contracts";
import { fixture, ref, path, gate, snapshot, roster } from "../../../host/tests/host-read-graph.test-support";
import { module as fans } from "../fans/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";
import { Effect } from "effect";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsPricingData, ductsNetworkData, ductsRosterData, valueReadResponse } from "@pe/agent-contracts";
import { InvalidRead } from "../../../host/src/native-reads";
import { registeredReads } from "../../../host/src/reads/routes";
import { ductsPricing, ductsNetwork, ductsRoster } from "../../../host/src/reads/ducts";
import { fansSheet } from "../../../host/src/reads/fans";
import { module as ducts } from "../ducts/route";
import { module as families } from "../families/route";
import type { TypedRoute } from "./typed-route";
import { commandContract } from "./typed-actions";
import { publicationSource } from "../host/publication-source";
import { builtinEnrollments } from "../../../host/src/builtin-enrollment";
import savedNetwork from "../ducts/fixtures/synthetic-snapshot.json";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context, Layer, Scope, Exit } from "effect";
import { admittedBuiltinsLayer } from "../../../host/src/admitted-builtins";
import { HttpRouter } from "effect/http";
import { RouteWorkspace } from "@pe/runtime";
import { bindWork } from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import {
  captureStore,
  detachedBridge,
  sessionView,
  familiesReader,
  testHostInputs, journalAt, callRouteOver } from "../../../host/tests/effect-test";
import { sdkSessions } from "../../../host/tests/native-receipt-fixture";
import { fileRouteDocumentStore } from "../../../host/src/route-document-store";
import { nativeReadRoot } from "../../../host/src/app";
import { RevitBridge } from "../../../host/src/bridge";
import { hostOwnership } from "../../../host/src/host-ownership";
import { RequestIdentity, admittedRequestIdentity } from "../../../host/src/request-services";
import { NodeServices, NodeHttpClient } from "../../../host/tests/family-attach-host.fixture";

const trace = z.array(z.object({ name: z.string(), args: z.unknown() }));


test("JZ Plan route switch: Ducts reads preserve the Fans seal; changed Work stales review", async () => {
  let nativeGeneration = "incarnation:24";
  const systemRoster = { ...roster, systems: roster.systems.slice(0, 1) };
  const j = await journey({ roster: systemRoster, snapshot: { ...snapshot, systems: systemRoster.systems }, freshness: () => nativeGeneration });
  const streams = new Set<{ close(): void }>();
  let mounted: ReturnType<typeof mountTypedRoute> | undefined;
  let held: ReturnType<typeof gate> | undefined;
  // EventSource is a browser platform shim over the actual host HTTP/SSE handler.
  class Stream {
    onmessage?: (event: { data: string }) => void;
    onerror?: () => void;
    private reader?: ReadableStreamDefaultReader<Uint8Array>;
    private closed = false;
    constructor(url: string) {
      streams.add(this);
      void (async () => {
        const response = await j.host.request(new Request(url));
        this.reader = response.body!.getReader();
        if (this.closed) return void this.reader.cancel();
        let buffer = "";
        const decoder = new TextDecoder();
        while (!this.closed) {
          const frame = await this.reader.read(); if (frame.done) break;
          buffer += decoder.decode(frame.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            for (const line of event.split("\n")) if (line.startsWith("data: ")) this.onmessage?.({ data: line.slice(6) });
          }
        }
      })().catch(() => { if (!this.closed) this.onerror?.(); });
    }
    addEventListener() {}
    removeEventListener() {}
    close() { this.closed = true; void this.reader?.cancel(); streams.delete(this); }
  }
  vi.stubGlobal("window", { location: { href: "http://host/", search: "" } });
  vi.stubGlobal("EventSource", Stream);
  try {
    await j.ready();
    const source = publicationSource({ read: (ctx, publication, release) => j.host.send(publication.generation,
      (ctx.args as { fan: string[] }).fan, undefined, publication.subscription, release) });
    const row = j.mount.value(fans.spec.reads!.roster).value.rows.find((row: { mark: string }) => row.mark === "MUAS-1")!;
    for (const route of ["fans", "ducts"])
      expect((await j.host.workspace.start(bindWork(route, path, undefined, ref), {}, "human")).ok).toBe(true);
    const work = createWorkFeedClient(
      { subscribe: observeResources(j.host.workspace, { observe: () => () => {} }), dirty() {} },
      { write: (key, write) => j.host.workspace.write(key, key.route, "human", write),
        // Native preview is recorded; publications and Work use the real host graph.
        submit: async command => actionReceiptSchema.parse({ ...command, state: "succeeded",
          steps: [], prepared: { state: "unprepared" }, recovery: [],
          caller: { kind: "human", via: "local" }, basis: null, startedAt: new Date().toISOString(),
          result: { previewOnly: true, takenAt: "2026-11-07T00:00:00Z",
            seal: { caller: { kind: "human", via: "local" }, requestHash: "sealed", work: { handle: command.input.work },
              documentMark: { ...ref, observedSince: 1, changedAt: 10 }, incarnation: {}, dependencies: "exact" },
            response: { writes: [{ id: row.unitId, kind: "equipment-flow", outcome: "planned", before: "880 cfm", after: "925 cfm" }],
              counts: { planned: 1, written: 0, refused: 0, unchanged: 0 } } } }) });
    const fingerprint = workFingerprintSchema.parse(`builtin-closure:${builtinEnrollments.find(e => e.routeKey === "fans")!.closure.fingerprint}`);
    mounted = mountTypedRoute(fans, { ...j.input, memory: () => ({ fan: { kind: "ids", ids: [stableFanKey(row)] } }) }, fingerprint,
      { work, sources: { "fans.sheet": source } });
    mounted.subscribe(() => {});
    await vi.waitFor(() => expect(mounted!.value().current).toBe(true), { timeout: 20_000 });
    await vi.waitFor(() => expect(streams.size).toBeGreaterThan(0));
    const before = mounted.value().value;
    held = j.host.holdNative();
    j.host.changed();
    await held.entered.promise;
    expect(mounted.value(), "H05: a host dirty event immediately withdraws current authority").toMatchObject({ current: false, value: before });
    held.release.resolve();
    await vi.waitFor(() => expect(mounted!.value().current).toBe(true), { timeout: 20_000 });
    await vi.waitFor(() => expect(mounted!.work(), mounted!.problem() ?? "Work ready").not.toBeNull());
    const key = mounted.work()!.handle.key;
    const staged = await j.host.workspace.apply(key, "fans", "human", [
      { path: ["writeIntent"], value: { edit: { value: { walk: { unitId: row.unitId, portIndex: row.portIndex } } } } },
      { path: ["equipmentFlows", elementSubject(row), "edit"], value: { value: { cfm: 925, source: "test" } } },
    ], mounted.work()!.revision);
    expect(staged.ok).toBe(true);
    mounted.refresh();
    await vi.waitFor(() => expect(mounted!.value().current).toBe(true), { timeout: 20_000 });
    await mounted.action("losses").plan();
    expect(mounted.review("losses")).toMatchObject({ stale: false, preview: expect.anything() });
    const sealed = mounted.value().publication!;
    // Reopening a source creates a new subscription/consumption, as on page reload.
    mounted.refresh();
    await vi.waitFor(() => expect(mounted!.value().current).toBe(true), { timeout: 20_000 });
    expect(mounted.value().publication!.inputs).not.toBe(sealed.inputs);
    expect(mounted.value().publication!.data).toEqual(sealed.data);
    expect(mounted.review("losses"), "identical sealed inputs remain Apply-eligible after reconnect").toMatchObject({ stale: false, preview: expect.anything() });
    expect(mounted.writeRefusal()).toBeNull();
    mounted.release();
    await vi.waitFor(() => expect(streams.size, "B05: hiding releases streams").toBe(0));
    mounted.subscribe(() => {});
    await vi.waitFor(() => expect(mounted!.value().current).toBe(true), { timeout: 20_000 });
    expect(mounted.review("losses"), "show reacquires identical inputs without retiring the Plan").toMatchObject({ stale: false, preview: expect.anything() });
    expect(mounted.writeRefusal()).toBeNull();
    mounted.release();
    const definitions = { ductsPricing, ductsNetwork, ductsRoster };
    const unregister = registeredReads.register(Object.fromEntries(Object.entries(definitions).filter(([, read]) => !registeredReads.reads.has(read.name))));
    const sources = Object.fromEntries(Object.values(definitions).map(definition => [definition.name + ".value", publicationSource({
      async read(ctx, publication, release) {
        const response = await j.host.probe({ read: definition.name, ...publication, release, args: { target: ref, ...(ctx.args as object) } });
        expect(response.ok, await response.clone().text()).toBe(true);
        return valueReadResponse.parse(await response.json());
      },
    })]));
    const ductMount = mountTypedRoute(ducts, { ...j.input, address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} } },
      workFingerprintSchema.parse(`builtin-closure:${builtinEnrollments.find(e => e.routeKey === "ducts")!.closure.fingerprint}`), { work, sources });
    try {
      await ductMount.whenReady();
      const system = ductMount.value(ducts.spec.reads!.roster).value.systems[0]!.name;
      ductMount.page.subject({ kind: "ids", ids: [systemCode(system)] });
      await ductMount.whenReady();
      expect(ductMount.value().value.network.systemReads.completed).toEqual([systemRoster.systems[0]!.id]);
    } finally { ductMount.dispose(); unregister(); }
    // The Driver recording has identical native content at admission generations :24 and :31.
    nativeGeneration = "incarnation:31";
    mounted.subscribe(() => {});
    await vi.waitFor(() => expect(mounted!.value().current).toBe(true), { timeout: 20_000 });
    expect(mounted.value().publication!.data).toEqual(sealed.data);
    expect(mounted.review("losses"), "return from a Ducts read preserves the sealed Plan").toMatchObject({ stale: false, preview: expect.anything() });
    expect(mounted.writeRefusal()).toBeNull();
    const changed = await j.host.workspace.apply(key, "fans", "human", [
      { path: ["equipmentFlows", elementSubject(row), "edit"], value: { value: { cfm: 950, source: "test" } } },
    ], mounted.work()!.revision);
    expect(changed.ok).toBe(true);
    mounted.refresh();
    await vi.waitFor(() => expect(mounted!.value().current).toBe(true), { timeout: 20_000 });
    expect(mounted.review("losses")).toMatchObject({ stale: true, rows: [], cells: [] });
    await expect(mounted.action("losses").apply()).rejects.toThrow(/stale/i);
    mounted.dispose();
    await vi.waitFor(() => expect(streams.size, "H05: disposal closes watched inputs").toBe(0));
  } finally { held?.release.resolve(); mounted?.dispose(); streams.forEach(stream => stream.close()); vi.unstubAllGlobals(); await j.close(); }
}, 60_000);

test("JM H02/B05 select a Fan whose native walk is malformed and inspect the refusal", async () => {
  const malformed = structuredClone(snapshot);
  // Recorded malformed native JSON is the trust boundary, never a substituted product decoder.
  Reflect.set(malformed, "nodes", "not a node collection");
  const j = await journey({ snapshot: malformed });
  try {
    await j.ready();
    const before = j.mount.value().value;
    const roster = j.mount.value(fans.spec.reads!.roster).value.rows;
    const row = roster.find((row: { mark: string }) => row.mark === "MUAS-1")!;
    j.mount.page.subject({ kind: "ids", ids: [stableFanKey(row)] });
    await vi.waitFor(() => expect(j.mount.value(), "H02: malformed native output cannot become current data").toMatchObject({ current: false, status: "unavailable" }));
    expect(j.mount.value().value, "B05: the last admitted Value survives").toEqual(before);
    const refused = j.mount.value();
    expect(!refused.current && refused.reason, "B05: failure gives human recovery words").not.toMatch(/invalid_type|expected.*array|ZodError/);
  } finally { await j.close(); }
}, 60_000);

// HTTP publications and file Work are real; only native inputs and the address port are recorded.
async function journey(recorded: Parameters<typeof fixture>[1] = {}) {
  const host = await fixture(true, recorded);
  // The HTTP fixture acquires its workspace lazily; construct feeds only after acquisition.
  await host.send(0, []);
  let generation = 0;
  let hold: ReturnType<typeof gate> | undefined;
  const pending = new Set<Promise<void>>();
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const delayed = hold;
      hold = undefined;
      const task = host
        .send(++generation, (ctx.args as { fan: string[] }).fan, delayed, `jx-${generation}`)
        .then((packet) => {
          deliver({ kind: "complete", value: packet, revision: packet.version });
        })
        .catch((error) => deliver({ kind: "failure", error }));
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return () => {};
    },
  };
  const work = createWorkFeedClient(
    { subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {} },
    {
      write: (key, write) => host.workspace.write(key, key.route, "human", write),
      submit: () => {
        throw Error("Unexpected native action in read journey");
      },
    },
  );
  let search = new URLSearchParams();
  const input = {
    target: { kind: "document" as const, ref },
    fixture: null,
    work: { address: path, open: ref },
    address: {
      read: () => new URLSearchParams(search),
      write: (next: URLSearchParams) => {
        search = new URLSearchParams(next);
      },
      subscribe: () => () => {},
    },
    custody: { current: () => true },
    memory: () => ({}),
  };
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${builtinEnrollments.find(entry => entry.routeKey === "fans")!.closure.fingerprint}`);
  const mount = mountTypedRoute(fans, input, fingerprint, {
    work,
    sources: { "fans.sheet": source },
  });
  const stop = mount.subscribe(() => {});
  const ready = () => mount.whenReady();
  return {
    host,
    mount,
    input,
    fingerprint,
    work,
    source,
    ready,
    delay() {
      hold = gate();
      return hold;
    },
    async close() {
      hold?.release.resolve();
      stop();
      mount.dispose();
      await Promise.allSettled([...pending]);
      await host.close();
    },
  };
}

test("JX1 compare named Fans and shared-fan Duct systems, clear scope, then close the document", async () => {
  const j = await journey();
  try {
    await j.ready();
    const roster = (await j.host.send(100, [])).value!.data.rows;
    const chosen = ["MUAS-1", "FC-23"].map((mark) => roster.find((row) => row.mark === mark)!);
    const ids = chosen.map(stableFanKey);
    for (const [index, id] of ids.entries()) {
      j.mount.page.subject({ kind: "ids", ids: [id] });
      await j.ready();
      expect(
        j.mount.subjectState({}),
        "B03: subject identity is presented by its fan name",
      ).toMatchObject({ ready: true, label: expect.stringContaining(chosen[index]!.mark!) });
    }
    j.mount.page.subject({ kind: "ids", ids });
    await j.ready();
    const packet = await j.host.send(101, ids);
    const data = packet.value!.data;
    expect(data.opened, "H23: each selected fan has its own engineering answer").toHaveLength(2);
    for (const row of chosen) {
      const open = data.opened!.find(
        (value) =>
          value.overview.fan?.unitId === row.unitId &&
          value.overview.fan.portIndex === row.portIndex,
      )!;
      expect(open, "H23: the answer retains the selected fan identity").toBeDefined();
      expect(
        data.rows.find(
          (value) => value.uniqueId === row.uniqueId && value.portIndex === row.portIndex,
        ),
        "H23: published pressure belongs to that fan's overview",
      ).toMatchObject({
        requiredEspInWg: open.overview.totals?.requiredEspInWg ?? null,
        complete:
          !!open.overview.totals?.supply.complete && !!open.overview.totals?.return.complete,
      });
      expect(open.overview.basis, "H23: engineering answer retains its provenance").toBeTruthy();
    }
    expect(packet.value!.coverage.unknown, "H23: selected scope reports its coverage").toEqual([]);
    const native = trace.parse(packet.value!.trace).filter((entry) => entry.name === "native");
    expect(native, "H15: discovery carries exact selected identities and storage type").toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          args: expect.objectContaining({
            target: { kind: "document", ref },
            request: expect.objectContaining({
              context: expect.objectContaining({
                StorageType: "Double",
                ElementUniqueIds: [...new Set(chosen.map((row) => row.uniqueId))].sort().join(","),
              }),
            }),
          }),
        }),
      ]),
    );
    j.mount.page.subject({ kind: "ids", ids: [] });
    await j.ready();
    const empty = await j.host.send(102, []);
    expect(
      empty.value!.data.opened,
      "H23: unread scope does not invent engineering answers",
    ).toEqual([]);
    expect(
      empty.value!.data.espOptions,
      "H15: empty selection does not discover the whole model",
    ).toBeNull();
    expect(
      trace
        .parse(empty.value!.trace)
        .filter((entry) => entry.name === "native")
        .every((entry) => !JSON.stringify(entry.args).includes("parameter-identities")),
      "H15: empty discovery never dispatches",
    ).toBe(true);
    expect(j.mount.page.read().fan, "B03: none stays explicit").toEqual({ kind: "ids", ids: [] });
  } finally {
    await j.close();
  }
  await compareSystemAnswers();
  await closeDocumentLifetime();
}, 60_000);

test("JX2 retain the pane through waiting, a refused subject, hiding and returning", async () => {
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.ready();
    const old = j.mount.value().value;
    held = j.delay();
    j.mount.refresh();
    await held.entered.promise;
    expect(
      j.mount.value(),
      "B05: waiting retains the answer and admits it is pending",
    ).toMatchObject({ current: false, status: "pending", value: old });
    held.release.resolve();
    await j.ready();
    const retained = j.mount.value().value;
    j.mount.page.subject({ kind: "ids", ids: [stableFanKey({ uniqueId: "missing-fan", portIndex: 0 })] });
    await vi.waitFor(() =>
      expect(j.mount.value(), "B05: refusal is honest and preserves the last answer").toMatchObject(
        {
          current: false,
          status: "unavailable",
          value: retained,
          reason: expect.stringContaining("unavailable"),
        },
      ),
    );
    j.mount.release();
    expect(j.mount.value().value, "B05: hiding retains the completed answer").toEqual(retained);
    const resume = j.mount.subscribe(() => {});
    try {
      j.mount.page.subject({ kind: "ids", ids: [] });
      await j.ready();
      expect(j.mount.value(), "B05: return can publish an honest current answer").toMatchObject({
        current: true,
        status: "ready",
      });
    } finally {
      resume();
    }
  } finally {
    held?.release.resolve();
    await j.close();
  }
}, 60_000);

test("JX3 open fixture Fans, change scope and attempt a native write without live fallthrough", async () => {
  const j = await journey();
  try {
    await j.ready();
    const calls = j.host.nativeCalls;
    const mounted = mountTypedRoute(fans, { ...j.input, fixture: "layout" }, j.fingerprint, {
      work: j.work,
      sources: { "fans.sheet": j.source },
    });
    try {
      mounted.page.subject({ kind: "all" });
      expect(
        mounted.value().publication?.origin,
        "H09: fixture publication discloses its origin",
      ).toMatchObject({ kind: "fixture", name: "layout" });
      expect(
        mounted.commandRefusal("losses"),
        "H09: fixture discloses native action refusal",
      ).toMatch(/Fixture/);
      await expect(
        mounted.action("losses").plan(),
        "H09: even direct invocation cannot write native",
      ).rejects.toThrow(/Fixture/);
      mounted.page.subject({ kind: "ids", ids: [] });
      expect(
        j.host.nativeCalls,
        "H09: fixture selection and attempted write never call native",
      ).toBe(calls);
    } finally {
      mounted.dispose();
    }
    expect(
      () =>
        mountTypedRoute(fans, { ...j.input, fixture: "not-a-fixture" }, j.fingerprint, {
          work: j.work,
          sources: { "fans.sheet": j.source },
        }),
      "H09: missing fixture refuses before mounting instead of using live inputs",
    ).toThrow("No fixture 'not-a-fixture'");
    expect(j.host.nativeCalls, "H09: missing fixture never dispatches native").toBe(calls);
  } finally {
    await j.close();
  }
}, 60_000);

async function compareSystemAnswers() {
  // Existing native-shaped purpose capture, with the same shared-fan variant as system-list.test.ts.
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(savedNetwork);
  for (const element of [...snapshot.nodes, ...snapshot.segments])
    element.uniqueId ||= `jx-native-${element.id}`;
  snapshot.groups[0]!.systemNames.push("SA 2");
  snapshot.systems.push({ ...snapshot.systems[0]!, id: 501, name: "SA 2" });
  for (const element of [...snapshot.nodes, ...snapshot.segments])
    if ([12, 22, 31].includes(element.id)) element.systemName = "SA 2";
  const roster = {
    ...snapshot,
    groups: [],
    segments: [],
    flows: [],
    nodes: snapshot.nodes.filter((node) => node.kind === "equipment"),
  };
  const host = await fixture(false, { snapshot, roster });
  await host.send(0, []);
  const definitions = { ductsPricing, ductsNetwork, ductsRoster };
  const unregister = registeredReads.register(
    Object.fromEntries(
      Object.entries(definitions).filter(
        ([, definition]) => !registeredReads.reads.has(definition.name),
      ),
    ),
  );
  let generation = 0;
  const sources = Object.fromEntries(
    Object.values(definitions).map((definition) => [
      `${definition.name}.value`,
      {
        kind: "use" as const,
        open(ctx, deliver) {
          return host
            .probe({
              read: definition.name,
              subscription: `jx-ducts-${++generation}`,
              generation,
              args: { target: ref, ...(ctx.args as object) },
            })
            .then(async (response) => {
              if (!response.ok) throw Error(await response.text());
              const packet = valueReadResponse.parse(await response.json());
              deliver({ kind: "complete", value: packet, revision: packet.version });
            })
            .catch((error) => deliver({ kind: "failure", error }));
        },
      } satisfies UseSource,
    ]),
  );
  const work = createWorkFeedClient(
    { subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {} },
    {
      write: (key, write) => host.workspace.write(key, key.route, "human", write),
      submit: () => {
        throw Error("Read journey has no native writes");
      },
    },
  );
  const mount = mountTypedRoute(
    ducts,
    {
      target: { kind: "document", ref },
      fixture: null,
      work: { address: path, open: ref },
      memory: () => ({}),
      custody: { current: () => true },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    { work, sources },
  );
  try {
    const staged = await host.workspace.apply(
      { route: "fans", binding: "address", target: path },
      "fans",
      "human",
      [30, 31].map((id, i) => ({
        path: ["terminalDrops", elementSubject(snapshot.nodes.find(node => node.id === id)!), "edit"],
        value: { value: { inWg: i ? 0.35 : 0.05 } },
      })),
      0,
    );
    expect(staged.ok).toBe(true);
    mount.page.subject({ kind: "all" });
    await vi.waitFor(
      () =>
        expect(
          mount.value(),
          `H23: both systems publish a current host Value: ${JSON.stringify(mount.value())}`,
        ).toMatchObject({ current: true }),
      { timeout: 20_000 },
    );
    const result = ductsPricingData.parse(mount.value().value);
    const first = result.analysis.systems.find((row) => row.name === "SA 1")!;
    const second = result.analysis.systems.find((row) => row.name === "SA 2")!;
    expect(
      first.total,
      "H23: sharing a fan does not copy the other system's pressure",
    ).toBeLessThan(second.total!);
    expect(
      first.split!.rows.some((row) => row.id === 30),
      "H23: first system retains its own terminal",
    ).toBe(true);
    expect(
      first.split!.rows.some((row) => row.id === 31),
      "H23: first system excludes the second terminal",
    ).toBe(false);
    expect(
      result.priced.flows["30"]?.source,
      "H23: terminal flow retains its provenance",
    ).toBeTruthy();
    expect(
      result.network.systemReads.missing,
      "H23: requested system coverage is explicit",
    ).toEqual([]);
    mount.page.subject({ kind: "ids", ids: [] });
    await vi.waitFor(() => expect(mount.value(ducts.spec.reads!.network).current).toBe(true), { timeout: 20_000 });
    const unread = ductsNetworkData.parse(mount.value(ducts.spec.reads!.network).value);
    expect(unread.systemReads.completed, "H23: none reads no systems").toEqual([]);
    // SubjectRef Work outside this acquisition cannot become current pricing or complete zeros.
    await vi.waitFor(() => expect(mount.value()).toMatchObject({
      current: false, status: "unavailable", reason: expect.stringContaining("Work subject is absent from the acquisition"),
    }));
    const unpriced = ductsRosterData.parse(mount.value(ducts.spec.reads!.roster).value);
    expect(
      unpriced.rows.every((row) => row.total === null),
      "H23: unread systems retain unknown pressure, never complete zeros",
    ).toBe(true);
  } finally {
    mount.dispose();
    unregister();
    await host.close();
  }
}

async function closeDocumentLifetime() {
  let open = true;
  const host = await fixture(false, {
    document: (requested) =>
      open && requested.session === ref.session && requested.openId === ref.openId
        ? Effect.succeed({ ...ref, address: path })
        : Effect.fail(
            new InvalidRead({
              message: "Document lifetime is closed or unknown",
              status: 409,
              problem: "target.closed",
            }),
          ),
  });
  const unregister = registeredReads.register(
    registeredReads.reads.has(fansSheet.name) ? {} : { fansSheet },
  );
  const read = (target: unknown) =>
    host.probe({
      read: "fans.sheet",
      subscription: "jx-lifetime",
      generation: 1,
      args: { target, fan: [], sheetPath: "" },
    });
  try {
    expect((await read(ref)).status, "H17: the resolved document lifetime is readable").toBe(200);
    const calls = host.nativeCalls;
    open = false;
    host.changed();
    for (const target of [
      ref,
      { ...ref, session: "replacement-process" },
      { ...ref, openId: "unknown" },
    ]) {
      const response = await read(target);
      const body = await response.json();
      expect(
        response.ok && body.state === "current",
        `H17: closed and replacement lifetimes refuse: ${JSON.stringify(body)}`,
      ).toBe(false);
      expect(host.nativeCalls, "H17: an invalid lifetime dispatches no native read").toBe(calls);
    }
  } finally {
    unregister();
    await host.close();
  }
}

test("JX4 Families apply readback cannot overwrite a newer manual read or certify an unread family", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jx-families-"));
  const target = { session: "session-a", openId: "open-a" };
  const key = bindWork("families", path, undefined, target);
  const workspace = new RouteWorkspace({
    registrations: [],
    store: fileRouteDocumentStore(join(dir, "work")),
  });
  const admissionScope = Scope.makeUnsafe();
  await Effect.runPromise(Layer.buildWithScope(admittedBuiltinsLayer(workspace), admissionScope));
  const filter = {
    categoryNames: ["Air Terminals"],
    familyNames: [],
    placementScope: "AllLoaded" as const,
  };
  await workspace.view(key, "families");
  await workspace.apply(
    key,
    "families",
    "human",
    [{ path: ["scope", "edit"], value: { value: filter } }],
    0,
  );
  const captures = captureStore(join(dir, "captures"));
  const family = {
    familyId: 1,
    familyUniqueId: "uid-1",
    familyName: "Diffuser",
    categoryName: "Air Terminals",
    typeNames: ["24x24"],
    parameters: [],
    issues: [],
    isPartial: false,
    placedInstanceCount: 0,
  };
  const observed = {
    families: [family],
    issues: [],
    page: { totalCount: 1, returnedCount: 1, isTruncated: false },
  };
  let hold: ReturnType<typeof gate> | undefined;
  let broken = false;
  let malformedOutput = false;
  const bridge = detachedBridge({
    list: Effect.sync(() => [
      sessionView({
        sessionId: target.session,
        connected: true,
        processId: 42,
        processStartUtcUnixMs: 1000,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        state: {
          openDocuments: [
            {
              openId: target.openId,
              address: path,
              title: "Families.rvt",
              isFamilyDocument: false,
            },
          ],
        },
      }),
    ]),
    invoke: (operation: string, raw: any) =>
      Effect.promise(async () => {
        let value: unknown;
        if (operation === "host.ops.catalog")
          value = {
            operations: [
              {
                key: "revit.matrix.loaded-families",
                intent: "Read",
                needs: "project-document",
                subject: "None",
                touches: "Metadata",
                effect: "Read",
                cardinality: "One",
                costTier: "Cheap",
              },
            ],
          };
        else if (operation === "revit.catalog.loaded-families")
          value = {
            summary: { truncated: false },
            families: [{ ...family, typeCount: 1, types: [{ typeId: 11, typeName: "24x24" }] }],
            issues: [],
          };
        else if (operation === "families.plan")
          value = {
            diagnostics: [],
            families: [
              {
                familyId: 1,
                familyName: "Diffuser",
                planHash: "jx-plan",
                changes: [],
                runEffects: ["Set Model"],
                refusals: [],
                warnings: [],
              },
            ],
          };
        else if (operation === "families.apply")
          value = {
            diagnostics: [],
            receipts: [
              {
                familyId: 1,
                familyName: "Diffuser",
                success: true,
                converged: true,
                residue: [],
                errors: [],
              },
            ],
          };
        else if (operation === "revit.matrix.loaded-families") {
          if (raw.phase === "Prepare")
            value = {
              families: [],
              issues: [],
              source: {
                families: [{ ...family, typeCount: 1, types: [] }],
                revitVersion: "2025",
                version: "v1",
                copyRefusal: "Recorded input",
              },
            };
          else if (raw.phase === "Extract")
            value = { families: [family], issues: [], elapsedMs: 1 };
          else {
            const paused = hold;
            hold = undefined;
            if (paused) {
              paused.entered.resolve();
              await paused.release.promise;
            }
            value = malformedOutput ? { families: "malformed native result" } : broken
              ? {
                  ...observed,
                  families: [
                    {
                      ...family,
                      isPartial: true,
                      issues: [
                        { code: "CollectorError", severity: "Error", message: "values unreadable" },
                      ],
                    },
                  ],
                }
              : observed;
          }
        } else throw Error(`Unexpected native input ${operation}`);
        return { target: { session: target.session, document: null }, value };
      }),
  });
  const journal = journalAt(join(dir, "actions.jsonl"), Date.now);
  const web = HttpRouter.toWebHandler(
    callRouteOver(
      journal,
      captures,
      { sdk: sdkSessions, workspace, podsRoot: dir },
      { families: await familiesReader() },
    ).pipe(
      nativeReadRoot(),
      Layer.provide(testHostInputs),
      Layer.provideMerge(
        Layer.mergeAll(
          Layer.succeed(RevitBridge, bridge),
          NodeServices.layer,
          NodeHttpClient.layerUndici,
        ),
      ),
    ),
    { disableLogger: true },
  );
  const caller = { kind: "human" as const, via: "local" as const };
  const invoke = async (command: string, extra = {}) => {
    const id = crypto.randomUUID();
    const work = (await workspace.view(key, "families"))!.handle;
    const response = await withInvocationContext({ caller }, () =>
      web.handler(
        new Request("http://host/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id,
            key: command,
            target: { kind: "document", ref: target },
            input: { work, ...extra },
          }),
        }),
        Context.make(RequestIdentity, admittedRequestIdentity(caller, {})),
      ),
    );
    expect(response.ok, await response.clone().text()).toBe(true);
    return journal.wait(id);
  };
  const apply = () => invoke("families.apply");
  let paused: ReturnType<typeof gate> | undefined;
  try {
    expect((await invoke("families.read", { readId: crypto.randomUUID() })).state).toBe(
      "succeeded",
    );
    const current = (await workspace.view(key, "families"))!;
    expect(
      await workspace.apply(
        key,
        "families",
        "human",
        [
          {
            path: ["writeIntent", "families.apply", "edit"],
            value: {
              value: {
                source: {
                  path: "settings/family/patch.json",
                  content: JSON.stringify({ family: { name: "Diffuser" } }),
                },
              },
            },
          },
        ],
        current.revision,
      ),
    ).toMatchObject({ ok: true });
    const preview = await invoke("families.apply.preview");
    expect(preview, JSON.stringify(preview)).toMatchObject({ state: "succeeded" });
    hold = paused = gate();
    const applying = apply();
    await Promise.race([
      paused.entered.promise,
      applying.then((row) => {
        throw Error(`Apply never reached readback: ${JSON.stringify(row)}`);
      }),
    ]);
    const manual = await invoke("families.read", { readId: crypto.randomUUID() });
    expect(manual.state).toBe("succeeded");
    const latest = await captures.latestFamilies(key);
    paused.release.resolve();
    const stale = await applying;
    expect(
      stale,
      "H34: the applied action reports stale targeted verification instead of replacing manual evidence",
    ).toMatchObject({
      state: "succeeded",
      result: expect.objectContaining({
        readbackError: expect.stringContaining("newer Families reading"),
      }),
    });
    expect(
      (await captures.latestFamilies(key))?.id,
      "H34: manual read stays the latest completed result",
    ).toBe(latest!.id);
    broken = true;
    expect((await invoke("families.apply.preview")).state).toBe("succeeded");
    const refused = await apply();
    expect(
      refused,
      "H34: a refused family batch cannot certify complete targeted coverage",
    ).toMatchObject({
      state: "succeeded",
      result: expect.objectContaining({ readbackError: expect.stringContaining("completely") }),
    });
    expect(
      (await captures.latestFamilies(key))?.id,
      "H34: failed verification retains the completed result",
    ).toBe(latest!.id);
    broken = false;
    const door = createWorkFeedClient({ subscribe: observeResources(workspace, { observe: () => () => {} }), dirty() {} }, {
      write: (key, write) => workspace.write(key, key.route, "human", write),
      submit: async command => {
        const response = await withInvocationContext({ caller }, () => web.handler(new Request("http://host/actions", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command),
        }), Context.make(RequestIdentity, admittedRequestIdentity(caller, {}))));
        expect(response.ok, await response.clone().text()).toBe(true);
        return journal.wait(command.id);
      },
    });
    const module: TypedRoute = { ...families, spec: { ...families.spec, core: undefined, commands: {
      read: { kind: "catalog" as const, entry: "families.read", contract: commandContract("families.read"),
        label: "Read Families", input: ({ work }) => ({ work, readId: crypto.randomUUID() }) },
    } } };
    const mounted = mountTypedRoute(module, {
      target: { kind: "document", ref: target }, fixture: null, work: { address: path, open: target },
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      memory: () => ({}), custody: { current: () => true },
    }, workFingerprintSchema.parse(`builtin-closure:${builtinEnrollments.find(entry => entry.routeKey === "families")!.closure.fingerprint}`), { work: door });
    try {
      mounted.subscribe(() => {});
      await vi.waitFor(() => expect(mounted.owner()?.ready, mounted.problem() ?? "Families owner pending").toBe(true));
      hold = paused = gate();
      const reading = mounted.action("read").run();
      await Promise.race([paused.entered.promise, reading.then(() => { throw Error("Families read never reached its held native boundary"); })]);
      const submitted = module.spec.commands.read!;
      Reflect.set(module.spec.commands, "read", { kind: "catalog", entry: "families.cancel-read",
        contract: commandContract("families.cancel-read"), label: "Cancel Families read" });
      paused.release.resolve();
      const output = await reading;
      expect(commandContract("families.read").output.safeParse(output).success,
        "H03: a replacement entry cannot change the submitted result decoder").toBe(true);
      Reflect.set(module.spec.commands, "read", submitted);
      const completed = await captures.latestFamilies(key);
      malformedOutput = true;
      await expect(mounted.action("read").run(), "H02/H03: malformed native output is a refused action, never a typed success").rejects.toThrow();
      expect((await captures.latestFamilies(key))?.id, "H03: failed native decoding preserves the completed observation").toBe(completed!.id);
      expect(mounted.action("read").failure, "H03: the typed action exposes its durable refusal").toBeTruthy();
    } finally { mounted.dispose(); }
  } finally {
    paused?.release.resolve();
    await journal.close();
    await web.dispose();
    await Effect.runPromise(Scope.close(admissionScope, Exit.void));
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
test("JZ H19 wait beyond the browser budget, then inspect queue and conflict refusals without retry", async () => {
  const { HOST_READ_WAIT_S, NATIVE_READ_WAIT_S } = await import("./waits");
  const { nativeFixture } = await import("../../../host/tests/fans-native.fixture");
  const { BridgeError } = await import("../../../host/src/bridge");
  const { callRouteOver, detachedBridge, testHostInputs } = await import("../../../host/tests/effect-test");
  const { serveRoutes } = await import("../../../host/tests/real-server");
  const { Effect, Layer } = await import("effect");
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.ready();
    const roster = await j.host.send(100, []);
    const row = roster.value!.data.fans.rows.find(row => row.mark === "MUAS-1")!;
    held = j.host.holdNative();
    j.mount.page.subject({ kind: "ids", ids: [stableFanKey(row)] });
    await held.entered.promise;
    const calls = j.host.nativeCalls;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await vi.advanceTimersByTimeAsync((Math.max(HOST_READ_WAIT_S, NATIVE_READ_WAIT_S) + 1) * 1000);
    expect(j.host.nativeCalls, "H19: browser waiting does not duplicate native dispatch").toBe(calls);
    expect(j.mount.value(), "H19: slow read is still pending").toMatchObject({ current: false, status: "pending" });
    vi.useRealTimers();
    held.release.resolve();
    await j.ready();
    expect(j.mount.value().current, "H19: original late answer lands").toBe(true);
    const f = await nativeFixture();
    try {
      let attempts = 0;
      const queueJournal = journalAt(`${j.host.dir}/queue.json`, Date.now);
      const server = await serveRoutes(callRouteOver(queueJournal, undefined, {}, { dispatch: () => {
        attempts++;
        return Effect.fail(new BridgeError("queue refused before send", 423, { notDispatched: true, nativeOutcome: "RefusedQueueUnresponsive" }));
      } }).pipe(Layer.provide(testHostInputs)), detachedBridge());
      try {
        const response = await fetch(`${server.base}/call`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "pod.list" }) });
        expect(response.status).toBe(423);
        expect(await response.json()).toMatchObject({ nativeOutcome: "RefusedQueueUnresponsive", notDispatched: true });
        expect(response.headers.get("retry-after"), "H19: no blind queue retry instruction").toBeNull();
        expect(attempts).toBe(1);
      } finally { await server.close(); await queueJournal.close(); }
      const work = { key: f.key, revision: 0 };
      const changed = await f.saved.apply(f.key, "ducts", "human", [{ path: ["writeIntent", "edit"], value: { value: { groups: ["group:g1"] } } }], 0);
      expect(changed.ok).toBe(true);
      const response = await f.post("/actions", { id: "jz-conflict", key: "sheet.apply", target: f.target, input: { work } });
      expect(response.ok).toBe(true);
      const receipt = await f.journal.wait("jz-conflict");
      expect(receipt.state, "H19: original stale revision is refused").not.toBe("succeeded");
      expect(f.dispatched, "H19: conflict cannot retry native mutation").toEqual([]);
      expect((await f.journal.list()).filter(row => row.key === "sheet.apply")).toHaveLength(1);
    } finally { await f.close(); }
  } finally { vi.useRealTimers(); held?.release.resolve(); await j.close(); }
}, 60_000);


test("JZ registry publishes fan roster and sheet through the shared read door only", async () => {
  const { fixture, ref } = await import("../../../host/tests/host-read-graph.test-support");
  const f = await fixture(true);
  try {
    let generation = 0;
    const read = async (name: string, args: object) => {
      const response = await f.request(new Request("http://host/pe/reads/value", {
        method: "POST", body: JSON.stringify({ read: name, args, subscription: "jz-registry", generation: ++generation }),
      }));
      expect(response.status, await response.clone().text()).toBe(200);
      return response.json();
    };
    const roster = await read("fans.roster", { target: ref });
    const fan = roster.value.data.rows.find((row: { mark: string }) => row.mark === "MUAS-1");
    expect(fan).toBeTruthy();
    const sheet = await read("ducts.sheet", { target: ref, mode: "fan", unitId: fan.unitId, portIndex: fan.portIndex });
    expect(sheet.value.data).toHaveProperty("basis");
    const fans = await read("fans.sheet", { target: ref, fan: [], sheetPath: "" });
    expect(fans.value.data.rows.length).toBeGreaterThan(0);
    for (const path of retiredReads.paths) {
      const response = await f.request(new Request(`http://host${path}`, { method: "POST", body: "{}" }));
      expect(response.status, path).toBe(404);
    }
  } finally { await f.close(); }
}, 60_000);
