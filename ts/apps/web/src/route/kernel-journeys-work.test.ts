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
  ductsRouteState,
  bindWork,
  workFingerprintSchema,
  type Caller,
  type WorkKey,
  type WorkWrite,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import { peRouteUrl } from "@pe/agent-contracts/pe-api";
import { withInvocationContext } from "@pe/runtime/context";
import { fixture, ref, path, who } from "../../../host/tests/host-read-graph.test-support";
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
import type { Readings } from "../readings";
import type { UseSource } from "../shell/readings";
import type { DrawContext } from "./typed-route";

// Only recorded native inputs and the address bar are adapters. Work, HTTP, SSE,
// the action registry, consent, journal and typed mount all run their production code.
async function journey() {
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
              if (line.startsWith("data: ")) deliver(JSON.parse(line.slice(6)));
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
  const work = createWorkFeedClient(source, {
    write: (key, body) => write(key, body),
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
  const mount = (readOnly = false) => {
    const m = mountTypedRoute(fans, { ...input, readOnly }, fingerprint, {
      work,
      sources: { "fans.sheet": read },
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
    depart() {
      current = false;
    },
    async start() {
      await ready();
      const id = crypto.randomUUID();
      await request("/actions", {
        id,
        key: "work.start",
        target: { kind: "host" },
        input: {
          key: bindWork("ducts", path, undefined, ref),
          seed: ductsRouteState.schema.parse({}),
        },
      });
      expect(await journal.wait(id)).toMatchObject({ state: "succeeded" });
      await vi.waitFor(() => expect(m.owner()?.absent).toBe(true));
      await m.startAction()!.run();
      await vi.waitFor(() => expect(m.owner()?.ready).toBe(true));
      await ready();
    },
    async close() {
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
