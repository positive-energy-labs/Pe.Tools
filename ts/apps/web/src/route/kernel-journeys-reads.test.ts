import { expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { observeResources } from "@pe/runtime";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { fixture, ref, path, gate } from "../../../host/tests/host-read-graph.test-support";
import { module as fans } from "../fans/route";
import { localId } from "./typed-route";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";

const trace = z.array(z.object({ name: z.string(), args: z.unknown() }));

// HTTP publications and file Work are real; only native inputs and the address port are recorded.
async function journey() {
  const host = await fixture(true);
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
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`);
  const mount = mountTypedRoute(fans, input, fingerprint, {
    work,
    sources: { "fans.sheet": source },
  });
  const stop = mount.subscribe(() => {});
  const ready = () =>
    vi.waitFor(() => expect(mount.value()).toMatchObject({ current: true }), { timeout: 20_000 });
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

test("JX1 choose named fans, compare their engineering answers and clear the scope", async () => {
  const j = await journey();
  try {
    await j.ready();
    const roster = (await j.host.send(100, [])).value!.data.rows;
    const chosen = ["MUAS-1", "FC-23"].map((mark) => roster.find((row) => row.mark === mark)!);
    const ids = chosen.map((row) => `${row.uniqueId}@${row.portIndex}`);
    for (const [index, id] of ids.entries()) {
      j.mount.page.subject({ kind: "ids", ids: [localId("ducts-fan", id)] });
      await j.ready();
      expect(
        j.mount.subjectState({}),
        "B03: subject identity is presented by its fan name",
      ).toMatchObject({ ready: true, label: expect.stringContaining(chosen[index]!.mark!) });
    }
    j.mount.page.subject({ kind: "ids", ids: ids.map((id) => localId("ducts-fan", id)) });
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
    j.mount.page.subject({ kind: "ids", ids: [localId("ducts-fan", "missing-fan@0")] });
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

test("JZ H19 wait beyond the browser budget, then inspect queue and conflict refusals without retry", async () => {
  const { HOST_READ_WAIT_S, NATIVE_READ_WAIT_S } = await import("./waits");
  const { nativeFixture } = await import("../../../host/tests/fans-native.fixture");
  const { makeCallRoute } = await import("../../../host/src/call-route");
  const { BridgeError } = await import("../../../host/src/bridge");
  const { detachedBridge, testHostInputs } = await import("../../../host/tests/effect-test");
  const { serveRoutes } = await import("../../../host/tests/real-server");
  const { Effect, Layer } = await import("effect");
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.ready();
    const roster = await j.host.send(100, []);
    const row = roster.value!.data.fans.rows.find(row => row.mark === "MUAS-1")!;
    held = j.host.holdNative();
    j.mount.page.subject({ kind: "ids", ids: [localId("ducts-fan", `${row.uniqueId}@${row.portIndex}`)] });
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
      const { ActionJournal } = await import("../../../host/src/action-journal");
      const queueJournal = new ActionJournal(`${j.host.dir}/queue.json`, Date.now);
      const server = await serveRoutes(makeCallRoute(queueJournal, undefined, {}, { dispatch: () => {
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
      const changed = await f.saved.apply(f.key, "ducts", "human", [{ path: ["writeIntent", "edit"], value: { value: { groups: ["g1"] } } }], 0);
      expect(changed.ok).toBe(true);
      const response = await f.post("/actions", { id: "jz-conflict", key: "ducts.apply-losses", target: f.target, input: { work } });
      expect(response.ok).toBe(true);
      const receipt = await f.journal.wait("jz-conflict");
      expect(receipt.state, "H19: original stale revision is refused").not.toBe("succeeded");
      expect(f.dispatched, "H19: conflict cannot retry native mutation").toEqual([]);
      expect((await f.journal.list()).filter(row => row.key === "ducts.apply-losses")).toHaveLength(1);
    } finally { await f.close(); }
  } finally { vi.useRealTimers(); held?.release.resolve(); await j.close(); }
}, 60_000);