import { join } from "node:path";
import { Context, Layer } from "effect";
import { HttpRouter } from "effect/http";
// Host-only dependency: this HTTP journey lives beside web route journeys.
import {
  NodeHttpClient,
  NodeServices,
} from "../../../host/node_modules/@effect/platform-node/dist/index.js";
import { expect, test, vi } from "vite-plus/test";
import {
  actionReceiptSchema,
  workFingerprintSchema,
  type Caller,
  type WorkKey,
  type WorkWrite,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { withInvocationContext } from "@pe/runtime/context";
import { fixture, ref, path, who, gate } from "../../../host/tests/host-read-graph.test-support";
import { builtinEnrollments } from "../../../host/src/builtin-enrollment";
import { ActionJournal } from "../../../host/src/action-journal";
import { makeCallRoute } from "../../../host/src/call-route";
import { nativeReadRoot } from "../../../host/src/app";
import { RevitBridgeLive } from "../../../host/src/bridge";
import { DuctFiles } from "../../../host/src/ducts-files";
import { HostDocumentMarks } from "../../../host/src/document-marks";
import { PictureCaptureStore } from "../../../host/src/captures-route";
import { createPeRoutes } from "../../../host/src/pe-routes";
import { RequestIdentity, admittedRequestIdentity } from "../../../host/src/request-services";
import { bindControl } from "../../../host/src/control";
import { testConsents } from "../../../host/tests/effect-test";
import type { ConsentEvent } from "../../../host/src/run-consent";
import { module as fans } from "../fans/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import { routeInput } from "./host";
import { localId } from "./typed-route";
import type { Readings } from "../host/resource-stream";
import type { UseSource } from "../shell/source-contract";
import type { DrawContext } from "./typed-route";

// Only recorded native inputs and the address bar are adapters. Work, HTTP, SSE,
// the action registry, consent, journal and typed mount all run their production code.
async function journey(module = fans) {
  const host = await fixture(true);
  const roster = await host.send(0, []);
  const fan = roster.value!.data.fans.rows.find((row) => row.mark === "MUAS-1")!;
  const journal = new ActionJournal(join(host.dir, "actions.jsonl"), Date.now);
  const events: ConsentEvent[] = [];
  const runs = testConsents((_run, event) => events.push(event));
  bindControl({ runs, acquired: () => null });
  const web = HttpRouter.toWebHandler(
    makeCallRoute(journal, undefined, { workspace: host.workspace }).pipe(
      nativeReadRoot(),
      Layer.provide(Layer.mergeAll(DuctFiles.layer(), HostDocumentMarks.layer)),
      Layer.provideMerge(PictureCaptureStore.layer(join(host.dir, "pictures"))),
      HttpRouter.provideRequest(Layer.mergeAll(NodeServices.layer, NodeHttpClient.layerUndici)),
      Layer.provideMerge(RevitBridgeLive),
    ),
    { disableLogger: true },
  );
  const api = createPeRoutes({
    workspace: host.workspace,
    registrations: [],
    navigation: { threads: async () => [], documents: async () => [{ ...ref, address: path }] },
  });
  const request = (url: string, body?: unknown, caller: Caller = who, headers = {}) => {
    const req = new Request(new URL(url, "http://host"), {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return withInvocationContext({ caller }, () =>
      url.startsWith("/actions") || url === "/call"
        ? web.handler(req, Context.make(RequestIdentity, admittedRequestIdentity(caller, {})))
        : api.fetch(req),
    );
  };
  const streams = new Set<() => void>();
  let streamHeld = false;
  const streamQueue: (() => void)[] = [];
  const source: Readings = {
    subscribe(reading, deliver) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
        closed = false;
      const stop = () => {
        closed = true;
        void reader?.cancel();
        streams.delete(stop);
      };
      streams.add(stop);
      void (async () => {
        const url = new URL(peRouteUrl("resources.stream", {}), "http://host");
        url.searchParams.set("keys", JSON.stringify([reading]));
        const response = await request(url.pathname + url.search);
        expect(response.headers.get("content-type")).toContain("text/event-stream");
        reader = response.body!.getReader();
        if (closed) return void reader.cancel();
        let buffer = "";
        const decoder = new TextDecoder();
        while (!closed) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            for (const line of frame.split("\n"))
              if (line.startsWith("data: ")) {
                const frame = JSON.parse(line.slice(6));
                if (streamHeld) streamQueue.push(() => deliver(frame)); else deliver(frame);
              }
          }
        }
      })();
      return stop;
    },
    dirty() {},
  };
  const write = async (key: WorkKey, body: WorkWrite, caller: Caller = who) => {
    const response = await request(
      peRouteUrl("work.apply", routeInput(key.route, key)),
      body,
      caller,
    );
    const value = await response.json();
    return (response.ok ? value : (value.error?.details ?? value)) as RouteStateWriteResult;
  };
  let heldWrite: ReturnType<typeof gate> | undefined;
  let beforeWrite: ReturnType<typeof gate> | undefined;
  const writes: WorkWrite[] = [];
  const work = createWorkFeedClient(source, {
    write: async (key, body) => {
      const held = heldWrite; heldWrite = undefined;
      writes.push(structuredClone(body));
      const before = beforeWrite; beforeWrite = undefined;
      if (before) { before.entered.resolve(); await before.release.promise; }
      const result = await write(key, body);
      if (held) { held.entered.resolve(); await held.release.promise; }
      return result;
    },
    submit: async (command) => {
      const response = await request("/actions", command);
      expect([200, 202], await response.clone().text()).toContain(response.status);
      await journal.wait(command.id);
      const settled = await request(`/actions?id=${command.id}`);
      return actionReceiptSchema.parse((await settled.json())[0]);
    },
  });
  let generation = 0,
    current = true;
  const pending = new Set<Promise<void>>();
  const read: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const id = ++generation;
      const task = host
        .send(id, (ctx.args as { fan: string[] }).fan, undefined, `jw-${id}`)
        .then((value) => {
          deliver({ kind: "complete", value, revision: value.version });
        });
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return () => {};
    },
  };
  const fingerprint = workFingerprintSchema.parse(
    `builtin-closure:${builtinEnrollments.find((e) => e.routeKey === "fans")!.closure.fingerprint}`,
  );
  const input = {
    target: { kind: "document" as const, ref },
    fixture: null,
    work: { address: path, open: ref },
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    custody: { current: () => current },
    memory: () => ({
      fan: { kind: "ids", ids: [localId("ducts-fan", `${fan.uniqueId}@${fan.portIndex}`)] },
    }),
  };
  const mounts: ReturnType<typeof mountTypedRoute>[] = [];
  const mount = (readOnly = false, place: Partial<typeof input> = {}, ports: Parameters<typeof mountTypedRoute>[3] = {}) => {
    const m = mountTypedRoute(module, { ...input, ...place, readOnly }, fingerprint, {
      work,
      sources: { "fans.sheet": read }, ...ports,
    });
    mounts.push(m);
    m.subscribe(() => {});
    return m;
  };
  const m = mount();
  const ready = () => {
    // The recorded HTTP read adapter has no graph invalidation socket. Use the
    // route's explicit Refresh door after a Work acknowledgement.
    m.refresh();
    return vi.waitFor(
      () => {
        expect(m.value()).toMatchObject({ current: true });
        if (m.owner()?.ready) expect(m.problem()).toBeNull();
      },
      { timeout: 20_000 },
    );
  };
  const cells = () =>
    m.draw("sheet-inputs", (ctx) => ctx.cells) as DrawContext<any, any, any, any>["cells"];
  const key = () => m.owner()!.handle!.key;
  return {
    host,
    journal,
    request,
    write,
    runs,
    events,
    m,
    mount,
    ready,
    cells,
    key,
    writes,
    holdBeforeWrite() { beforeWrite = gate(); return beforeWrite; },
    holdStream() { streamHeld = true; },
    flushStream() { streamHeld = false; streamQueue.splice(0).forEach(deliver => deliver()); },
    holdWrite() { heldWrite = gate(); return heldWrite; },
    depart() {
      current = false;
    },
    async start() {
      await ready();
      await vi.waitFor(() => expect(m.owner()?.absent).toBe(true));
      await vi.waitFor(() => expect(m.owner("ducts")?.absent).toBe(true));
      await m.startAction()!.run();
      await vi.waitFor(() => expect(m.owner()?.ready).toBe(true));
      await vi.waitFor(() => expect(m.owner("ducts")?.ready).toBe(true));
      await ready();
    },
    async close() {
      // Refused intents outlive a Place in production, but not this disposable host fixture.
      mounts.forEach(m => m.journal().intents.forEach(intent => m.discardIntent(intent.id)));
      mounts.forEach((m) => m.dispose());
      streams.forEach((stop) => stop());
      await Promise.allSettled([...pending]);
      runs.closeAll();
      await web.dispose();
      await journal.close();
      await host.close();
    },
  };
}

test("JZ release reads preserves Work edits until departure or disposal", async () => {
  const j = await journey();
  try {
    await j.start();
    const cells = j.cells(), token = cells.basis!;
    const revision = j.m.owner()!.handle!.revision;
    j.m.release();
    expect(j.m.current(token)).toBe(true);
    expect(await cells.at(["flows", "4"]).stage({ cfm: 270 }, { label: "Edit after read release" })).toBeNull();
    expect(j.m.available()).toBe(true);
    expect(j.m.owner()!.handle!.revision).toBe(revision + 1);
    expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 270 });
    // Read release does not relax the captured revision fence.
    expect(await cells.at(["flows", "4"]).stage({ cfm: 280 }, { label: "Old draw" })).toMatchObject({ code: "refused" });
    const reopened = j.mount(false, { custody: { current: () => true } });
    await vi.waitFor(() => expect(reopened.owner()?.ready).toBe(true));
    expect(reopened.owner()!.handle!.revision).toBe(revision + 1);
    expect(reopened.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 270 });
    const stop = j.m.subscribe(() => {}); stop();
    await j.ready();
    const retained = j.cells().at(["flows", "4"]);
    j.depart();
    expect(await retained.stage({ cfm: 290 }, { label: "After departure" })).toMatchObject({ code: "refused" });
    await vi.waitFor(() => expect(reopened.workBasis()).toBeTruthy());
    const disposedCell = (reopened.draw("sheet-inputs", ctx => ctx.cells) as DrawContext<any, any, any, any>["cells"]).at(["flows", "4"]);
    reopened.dispose();
    expect(await disposedCell.stage({ cfm: 300 }, { label: "After disposal" })).toMatchObject({ code: "refused" });
    expect(reopened.owner()!.handle!.revision).toBe(revision + 1);
    expect(reopened.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 270 });
  } finally { await j.close(); }
}, 60_000);

test("JW1 edit typed flows and race two atomic HTTP writes at the accepted revision", async () => {
  const j = await journey();
  try {
    await j.start();
    expect(
      await j.cells().at(["flows", "4"]).stage({ cfm: 240 }, { label: "Terminal A airflow" }),
      "H02: typed flow commits",
    ).toBeNull();
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc);
    const expectedRevision = j.m.owner()!.handle!.revision;
    const malformed = await j.write(j.key(), {
      kind: "apply",
      expectedRevision,
      press: crypto.randomUUID(),
      patches: [
        { path: ["flows", "4", "edit"], value: { value: { cfm: "wrong" } } },
        { path: ["undeclared"], value: 1 },
      ],
    });
    expect(malformed, "H02: malformed values and undeclared fields refuse at HTTP").toMatchObject({
      ok: false,
    });
    expect(j.m.owner()!.doc, "H08: malformed batch changes no path").toEqual(before);
    const contenders = await Promise.all(
      [410, 520].map((cfm) =>
        j.write(j.key(), {
          kind: "apply",
          expectedRevision,
          press: crypto.randomUUID(),
          label: `Set both flows to ${cfm}`,
          patches: ["4", "999"].map((id) => ({
            path: ["flows", id, "edit"],
            value: { value: { cfm } },
          })),
        }),
      ),
    );
    expect(
      contenders.filter((r) => r.ok),
      "H08: exactly one concurrent revision is acknowledged",
    ).toHaveLength(1);
    expect(
      contenders.filter((r) => !r.ok),
      "H08: the other writer is refused",
    ).toHaveLength(1);
    await vi.waitFor(() => expect(j.m.owner()!.handle!.revision).toBe(expectedRevision + 1));
    await j.ready();
    expect(
      j.m.owner()!.doc.flows["4"].edit.value,
      "H08: both paths belong to the same atomic winner",
    ).toEqual(j.m.owner()!.doc.flows["999"].edit.value);
  } finally {
    await j.close();
  }
}, 60_000);

test("JM B06 complete an acknowledged HTTP edit after its typed Page is disposed", async () => {
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.start();
    held = j.holdWrite();
    const writing = j.cells().at(["flows", "4"]).stage({ cfm: 410 }, { label: "Departing airflow" });
    await held.entered.promise;
    j.m.dispose();
    const retired = structuredClone(j.m.owner()!.doc);
    held.release.resolve();
    await writing;
    expect(j.m.owner()!.doc, "B06: a retired pane cannot receive a late Work completion").toEqual(retired);
    const replacement = j.mount();
    await vi.waitFor(() => expect(replacement.owner()?.ready).toBe(true));
    expect(replacement.owner()!.doc.flows["4"].edit.value,
      "H03: the host acknowledgement stays durable for a new inspection").toEqual({ cfm: 410 });
  } finally { held?.release.resolve(); await j.close(); }
}, 60_000);

test("JW2 receive Pea proposals, accept and deny individual cells without changing stored facts", async () => {
  const j = await journey();
  try {
    await j.start();
    const by: Caller = { kind: "pea", context: "jw", thread: "jw-proposals" };
    const stored = structuredClone(j.m.value().value.sheetSnapshot);
    expect(
      stored.nodes.length,
      "H20: proposal journey starts with actual recorded native facts",
    ).toBeGreaterThan(0);
    const revision = j.m.owner()!.handle!.revision;
    const proposal = await j.write(
      j.key(),
      {
        kind: "apply",
        expectedRevision: revision,
        press: crypto.randomUUID(),
        label: "Propose two flows",
        patches: [
          { path: ["flows", "4"], value: { edit: { value: { cfm: 250 } } } },
          { path: ["flows", "999"], value: { edit: { value: { cfm: 350 } } } },
        ],
      },
      by,
    );
    expect(
      proposal,
      `H20: typed proposals are acknowledged: ${JSON.stringify(proposal)}`,
    ).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(j.m.owner()!.handle!.revision).toBeGreaterThan(revision));
    await j.ready();
    const b = structuredClone(j.m.owner()!.doc.flows["999"]);
    expect(j.m.owner()!.doc.flows["4"].edit.by, "H20: proposed authorship is Pea").toBe("pea");
    expect(
      await j.cells().at(["flows", "4"]).accept({ label: "Take A proposal" }),
      "H20: human takes only A",
    ).toBeNull();
    await j.ready();
    expect(j.m.owner()!.doc.flows["4"].edit.by).toBe("human");
    expect(j.m.owner()!.doc.flows["999"], "H20: unrelated proposal is intact").toEqual(b);
    expect(
      await j.cells().at(["flows", "999"]).deny({ label: "Deny B proposal" }),
      "H20: deny removes only pending B",
    ).toBeNull();
    await j.ready();
    expect(j.m.owner()!.doc.flows["999"]?.edit, "H20: deny clears the proposed edit").toBeNull();
    expect(
      j.m.value().value.sheetSnapshot,
      "H20: stored native facts survive proposal transitions",
    ).toEqual(stored);
    expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 250 });
  } finally {
    await j.close();
  }
}, 60_000);

test("JM H27 interleave a second writer, refuse the original undo and keep its named history", async () => {
  const j = await journey();
  try {
    await j.start();
    expect(await j.cells().at(["flows", "4"]).stage({ cfm: 240 }, { label: "Set terminal airflow" })).toBeNull();
    await j.ready();
    const step = j.m.history.entries.at(-1)!;
    expect(await j.m.history.undo(step.press), "H07: typed Work undoes the named edit").toMatchObject({ ok: true });
    await j.ready();
    expect(await j.m.history.redo(step.press), "H07: typed Work redoes the same edit").toMatchObject({ ok: true });
    await j.ready();
    const result = await j.write(j.key(), { kind: "apply", expectedRevision: j.m.owner()!.handle!.revision,
      press: crypto.randomUUID(), label: "Another designer changes airflow",
      patches: [{ path: ["flows", "4", "edit"], value: { value: { cfm: 500 } } }] });
    expect(result).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 500 }));
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc), revision = j.m.owner()!.handle!.revision;
    const undo = await j.m.history.undo(step.press);
    expect(undo, "H27: a changed affected path refuses its original inverse").toMatchObject({ ok: false });
    expect(j.m.owner()!.doc, "H27: conflicting undo changes no path").toEqual(before);
    expect(j.m.owner()!.handle!.revision, "H27: no inverse retry writes a new revision").toBe(revision);
    expect(j.m.history.entries.some(entry => entry.press === step.press), "H27: the named entry survives refusal").toBe(true);
  } finally { await j.close(); }
}, 60_000);

test("JM H01/H13 hide one document, inspect another and reopen the first named Work history", async () => {
  const j = await journey();
  try {
    await j.start();
    expect(await j.cells().at(["flows", "4"]).stage({ cfm: 240 }, { label: "Terminal A design airflow" })).toBeNull();
    await j.ready();
    const firstKey = j.m.owner()!.scope.key;
    j.m.release();
    const other = j.mount(false, { work: { address: path.replace("Chadds", "Other") as typeof path, open: ref } });
    await vi.waitFor(() => expect(other.owner()?.absent).toBe(true));
    expect(other.owner()!.scope.key, "H01: a second document acquires its own Work").not.toEqual(firstKey);
    expect(j.m.owner()!.scope.key, "H01: a hidden Place cannot acquire the active document's Work").toEqual(firstKey);
    other.dispose();
    const reopened = j.mount();
    await vi.waitFor(() => expect(reopened.owner()?.ready).toBe(true));
    expect(reopened.owner()!.scope.key).toEqual(firstKey);
    expect(reopened.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 240 });
    expect(JSON.stringify(reopened.journal()), "H13: cold reopening retains the human action label").toContain("Terminal A design airflow");
  } finally { await j.close(); }
}, 60_000);

test("JM H12 leave a Page with drawn cells, inspect it, and refuse both old edits and native planning", async () => {
  const j = await journey();
  try {
    await j.start();
    const cell = j.cells().at(["flows", "4"]), before = structuredClone(j.m.owner()!.doc);
    const receipts = (await j.journal.list()).length;
    j.depart();
    expect(j.m.value().value, "H12: departure preserves inspection").toBeDefined();
    expect(await cell.stage({ cfm: 700 }, { label: "Late airflow" }), "H12: captured cell cannot write after departure").toMatchObject({ code: "refused" });
    await expect(j.m.action("losses").plan(), "H12: departure cannot acquire a new native plan").rejects.toThrow("Place");
    expect(j.m.owner()!.doc).toEqual(before);
    expect((await j.journal.list()).length, "H12: neither path submits a native action").toBe(receipts);
  } finally { await j.close(); }
}, 60_000);

test("JM H30 refuse a stale drawn edit and retain its original intent across refresh", async () => {
  const j = await journey();
  try {
    await j.start();
    const old = j.cells().at(["flows", "4"]);
    expect(await j.cells().at(["flows", "999"]).stage({ cfm: 300 }, { label: "Newer sibling edit" })).toBeNull();
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc);
    expect(await old.stage({ cfm: 731 }, { label: "Keep my original airflow" })).toMatchObject({ code: "refused" });
    await j.ready();
    expect(j.m.owner()!.doc, "H30: stale intent never recomputes on newer Work").toEqual(before);
    expect(JSON.stringify(j.m.journal()), "H30: rejected input remains inspectable until explicit discard").toContain("Keep my original airflow");
  } finally { await j.close(); }
}, 60_000);

test("JZ C121/C090 drawn authority rejects copied, foreign and old bases without recompute or retry", async () => {
  const j = await journey();
  try {
    await j.start();
    const drawn = j.cells(), old = drawn.basis!;
    expect(j.m.current(old)).toBe(true);
    expect(j.m.current({ ...old } as typeof old)).toBe(false);
    const replacement = j.mount();
    await vi.waitFor(() => expect(replacement.owner()?.ready).toBe(true));
    expect(replacement.current(old)).toBe(false);
    expect(await drawn.at(["flows", "4"]).stage({ cfm: 200 })).toBeNull();
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc), count = j.writes.length;
    const edit = { cfm: 731 };
    expect(await drawn.patch([{ path: ["flows", "4", "edit"], value: { value: edit } }],
      { label: "Original refused airflow" })).toMatchObject({ code: "refused" });
    expect(j.m.current(old)).toBe(false);
    const intent = j.m.journal().intents.find(i => i.label === "Original refused airflow")!;
    expect(intent.input.expectedRevision).toBe(old.workRevision);
    expect(intent.input.patches).toEqual([{ path: ["flows", "4", "edit"], value: { value: edit } }]);
    expect(Object.isFrozen(intent.input.patches)).toBe(true);
    expect(await drawn.patch(intent.input.patches, { label: "Retry original refused airflow" })).toMatchObject({ code: "refused" });
    expect(j.writes).toHaveLength(count);
    expect(j.m.owner()!.doc).toEqual(before);
    j.m.discardIntent(intent.id);
    expect(j.m.journal().intents.some(i => i.id === intent.id)).toBe(false);
    expect(await j.cells().at(["flows", "4"]).stage({ cfm: 201 })).toBeNull();
  } finally { await j.close(); }
}, 60_000);

test("JZ C122 delayed mounted submit retains its revision after a newer edit", async () => {
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.start();
    const revision = j.m.owner()!.handle!.revision;
    held = j.holdBeforeWrite();
    const pending = j.cells().at(["flows", "4"]).stage({ cfm: 200 });
    await held.entered.promise;
    expect(await j.cells().at(["flows", "4"]).stage({ cfm: 500 })).toBeNull();
    await j.ready();
    held.release.resolve();
    expect(await pending).toMatchObject({ code: "refused" });
    expect(j.writes.slice(-2).map(w => w.expectedRevision)).toEqual([revision, revision]);
    expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 500 });
    expect(j.m.journal().intents.at(-1)!.input.patches).toEqual([
      { path: ["flows", "4", "edit"], value: { value: { cfm: 200 } } },
    ]);
  } finally { held?.release.resolve(); await j.close(); }
}, 60_000);

test.each(["ack-first", "stream-first"])("JZ C086 %s delivery and pending departure recover durable Work", async order => {
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.start();
    if (order === "ack-first") j.holdStream(); else held = j.holdWrite();
    const pending = j.cells().at(["flows", "4"]).stage({ cfm: 210 });
    if (held) {
      await held.entered.promise;
      await vi.waitFor(() => expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 210 }));
      held.release.resolve();
    }
    expect(await pending).toBeNull();
    expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 210 });
    j.flushStream(); await j.ready();
    held = j.holdBeforeWrite();
    const departing = j.cells().at(["flows", "4"]).stage({ cfm: 310 });
    await held.entered.promise;
    j.m.dispose();
    const retired = structuredClone(j.m.owner()!.doc);
    held.release.resolve();
    expect(await departing).toBeNull();
    expect(j.m.owner()!.doc).toEqual(retired);
    const reopened = j.mount();
    await vi.waitFor(() => expect(reopened.owner()?.doc.flows["4"]?.edit.value).toEqual({ cfm: 310 }));
  } finally { held?.release.resolve(); j.flushStream(); await j.close(); }
}, 60_000);

test("JZ C718/C675/C676/C730 atomic press, isolated cell undo, root addressing and locked deletion", async () => {
  const j = await journey();
  try {
    await j.start();
    const original = structuredClone(j.m.owner()!.doc);
    expect(await j.cells().patch(["4", "999"].map(id => ({ path: ["flows", id, "edit"], value: { value: { cfm: 240 } } })),
      { label: "Both terminals" })).toBeNull();
    await j.ready();
    const step = j.m.journal().undo.at(-1)!;
    expect(j.m.journal().undo.filter(s => s.press === j.writes.at(-1)!.press), JSON.stringify(j.m.journal())).toHaveLength(1);
    expect(step.transitions).toHaveLength(1);
    expect(step.transitions[0]!.forward).toHaveLength(2);
    expect(step.transitions[0]!.inverse).toHaveLength(2);
    expect(j.writes.at(-1)!.press).toBe(step.press);
    expect(await j.m.history.undo(step.press)).toMatchObject({ ok: true });
    await j.ready(); expect(j.m.owner()!.doc).toEqual(original);
    expect(await j.cells().patch(["4", "999"].map(id => ({ path: ["flows", id], value: { edit: { value: { cfm: 250 } } } })))).toBeNull();
    await j.ready();
    const before = structuredClone(j.m.owner()!.doc), steps = j.m.journal().undo.length;
    for (const [id, action] of [["4", "clear"], ["999", "clear"], ["4", "delete"]] as const) {
      expect(await j.cells().at(["flows", id])[action]({ label: `${action} ${id}` })).toBeNull();
      await j.ready();
    }
    expect(j.m.owner()!.doc.flows["4"]).toBeUndefined();
    expect(j.m.journal().undo).toHaveLength(steps + 3);
    expect(j.m.journal().undo.slice(-3).map(s => s.transitions.length)).toEqual([1, 1, 1]);
    for (let i = 0; i < 3; i++) { expect(await j.m.history.undo()).toMatchObject({ ok: true }); await j.ready(); }
    expect(j.m.owner()!.doc).toEqual(before);
    expect(await j.cells().at(["designFriction"]).stage(0.1)).toBeNull(); await j.ready();
    const rootBefore = structuredClone(j.m.owner()!.doc), rootSteps = j.m.journal().undo.length;
    expect(() => j.cells().at(["foreignRoot"])).toThrow("No owning Work");
    expect(await j.cells().at(["designFriction"]).clear()).toBeNull(); await j.ready();
    expect(await j.cells().at(["designFriction"]).delete()).toBeNull(); await j.ready();
    expect(j.m.owner()!.doc.designFriction).toEqual({});
    expect(j.m.journal().undo).toHaveLength(rootSteps + 2);
    for (let i = 0; i < 2; i++) { expect(await j.m.history.undo()).toMatchObject({ ok: true }); await j.ready(); }
    expect(j.m.owner()!.doc).toEqual(rootBefore);
    const locked = j.cells().at(["flows", "4"], undefined, { readOnly: true });
    const writes = j.writes.length;
    expect(await locked.delete()).toMatchObject({ code: "read-only" });
    expect(await locked.clear()).toMatchObject({ code: "read-only" });
    expect(j.writes).toHaveLength(writes);
    expect(j.m.owner()!.doc).toEqual(rootBefore);
  } finally { await j.close(); }
}, 60_000);

// A command read cannot publish into a Page generation that did not invoke it.
test("JZ direct query drops a retired Page reply after A-B-A and discloses the refusal", async () => {
  const { z } = await import("zod");
  const { queryAction } = await import("./typed-actions");
  const held = gate();
  let j: Awaited<ReturnType<typeof journey>>;
  const module = { ...fans, spec: { ...fans.spec, commands: { ...fans.spec.commands,
    audit: { ...queryAction({ key: "fans.audit-generation", input: z.strictObject({}),
      run: async () => {
        held.entered.resolve();
        await held.release.promise;
        return j.host.send(901, []);
      } }), label: "Read fan" },
  } } };
  j = await journey(module);
  try {
    await j.start();
    const pageA = j.m.page.read().fan, tokenA = j.m.workBasis()!;
    const pending = j.m.action("audit").run({}).then(value => ({ value }), error => ({ error }));
    await held.entered.promise;
    j.m.page.subject({ kind: "ids", ids: [] });
    j.m.page.subject(pageA);
    expect(j.m.current(tokenA), "A-B-A retires the original generation").toBe(false);
    held.release.resolve();
    const outcome = await pending;
    expect(outcome).toHaveProperty("error", expect.any(Error));
    expect(j.m.result("audit"), "Retired query output never enters the current result slot").toBeUndefined();
    expect(j.m.action("audit").failure, "The waiting user sees why their read did not land").toMatch(/earlier Page/);
    expect(j.writes).toHaveLength(0);
    const current = await j.m.action("audit").run({});
    expect(j.m.result("audit"), "A fresh invocation can publish normally").toEqual(current);
    expect(j.m.action("audit").failure).toBeNull();
  } finally { held.release.resolve(); await j.close(); }
}, 60_000);

test("JZ raw Work patch paths and ambiguous operation fields refuse atomically at HTTP", async () => {
  const j = await journey();
  try {
    await j.start();
    const before = structuredClone(j.m.owner()!.doc), revision = j.m.owner()!.handle!.revision;
    const patches = [
      { path: ["flows", "4"], op: "delete", value: { edit: { value: { cfm: 220 } } } },
      { path: ["missing"], value: {} },
      { path: ["flows", "4", "missing"], value: 2 },
      { path: ["flows", "__proto__"] },
      { path: ["flows", "constructor"] },
      { path: ["flows"], value: 2 },
      { path: ["flows", "4", "edit"], value: { value: { cfm: "wrong" } } },
      { path: ["designFriction", "edit"], value: { value: "wrong" } },
    ];
    const outcomes: Array<{ patch: unknown; accepted: boolean }> = [];
    for (const patch of patches) {
      const response = await j.request(peRouteUrl("work.apply", routeInput(j.key().route, j.key())), {
        kind: "apply", expectedRevision: j.m.owner()!.handle!.revision, press: crypto.randomUUID(), patches: [patch],
      });
      const outcome = await response.json();
      outcomes.push({ patch, accepted: response.ok && outcome.ok === true });
    }
    expect(outcomes.filter(row => row.accepted), "No ambiguous, unsafe or ill-typed path is admitted").toEqual([]);
    await j.ready();
    expect(j.m.owner()!.doc).toEqual(before);
    expect(j.m.owner()!.handle!.revision).toBe(revision);
    expect(await j.cells().at(["flows", "4"]).stage({ cfm: 240 })).toBeNull();
    await j.ready();
    expect(j.m.owner()!.doc.flows["4"].edit.value).toEqual({ cfm: 240 });
  } finally { await j.close(); }
}, 60_000);

test("JZ a null Place target refuses Work before dispatch but still permits client Page moves", async () => {
  const j = await journey();
  try {
    await j.start();
    const unbound = j.mount(false, { target: null });
    await vi.waitFor(() => expect(unbound.owner()?.ready).toBe(true));
    await vi.waitFor(() => expect(unbound.value().current).toBe(true));
    const before = structuredClone(unbound.owner()!.doc), revision = unbound.owner()!.handle!.revision;
    const count = j.writes.length;
    const cells = unbound.draw("sheet-inputs", ctx => ctx.cells) as DrawContext<any, any, any, any>["cells"];
    expect(await cells.at(["flows", "4"]).stage({ cfm: 330 }), "No target means no write authority").toMatchObject({ code: "refused" });
    expect(j.writes).toHaveLength(count);
    expect(unbound.owner()!.doc).toEqual(before);
    expect(unbound.owner()!.handle!.revision).toBe(revision);
    unbound.page.query({ sheetPath: "inspection-only" });
    expect(unbound.page.read().sheetPath).toBe("inspection-only");
  } finally { await j.close(); }
}, 60_000);

test("JZ released reads resume once after custody returns through an unchanged address", async () => {
  const j = await journey();
  const tasks = new Set<Promise<unknown>>(), listeners = new Set<() => void>();
  let current = true, reads = 0;
  const source: UseSource = { kind: "use", open(ctx, deliver) {
    const generation = ++reads;
    const task = j.host.send(generation, (ctx.args as { fan: string[] }).fan, undefined, `lease-${generation}`)
      .then(value => { if (!ctx.signal.aborted) deliver({ kind: "complete", value, revision: generation }); });
    tasks.add(task); void task.finally(() => tasks.delete(task));
    return () => {};
  } };
  try {
    await j.start();
    const m = j.mount(false, { custody: { current: () => current }, address: {
      read: () => new URLSearchParams(), write() {}, subscribe(notify) { listeners.add(notify); return () => { listeners.delete(notify); }; },
    } }, { sources: { "fans.sheet": source } });
    await Promise.allSettled([...tasks]);
    expect(m.value().current).toBe(true);
    const initial = reads, retained = m.value().value;
    expect(initial).toBeGreaterThan(0);
    m.release(); current = false;
    const stop = m.subscribe(() => {});
    expect(reads, "A hidden Place cannot acquire another native read").toBe(initial);
    expect(m.value().value).toEqual(retained);
    current = true; listeners.forEach(notify => notify());
    await vi.waitFor(() => expect(reads, "Address notification resumes each declared read once").toBe(initial * 2));
    await Promise.allSettled([...tasks]);
    expect(m.value().current).toBe(true);
    listeners.forEach(notify => notify());
    expect(reads, "An equal current address cannot duplicate the subscription").toBe(initial * 2);
    stop();
  } finally { await Promise.allSettled(tasks); await j.close(); }
}, 60_000);
