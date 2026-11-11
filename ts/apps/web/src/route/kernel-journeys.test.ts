import { stableFanKey } from "../ducts/sheet/model";
import { expect, test, vi } from "vite-plus/test";
import { observeResources } from "@pe/runtime";
import { historyPointSchema, workFingerprintSchema } from "@pe/agent-contracts";
import { registeredReads } from "../../../host/src/reads/routes";
import { fansSheet } from "../fans/host";
import { fixture, ref, path, gate } from "../../../host/tests/host-read-graph.test-support";
import { module as fans } from "../fans/route";
import { mountTypedRoute } from "../shell/typed-mount";
import { createWorkFeedClient } from "../shell/work-feed-client";
import type { UseSource } from "../shell/source-contract";

// Reuse the existing host HTTP fixture. Only native input and the address bar are recorded adapters.
async function journey() {
  const host = await fixture(true);
  const first = await host.send(0, []);
  const work = createWorkFeedClient(
    { subscribe: observeResources(host.workspace, { observe: () => () => {} }), dirty() {} },
    {
      write: (key, write) => host.workspace.write(key, key.route, "human", write),
      submit: () => {
        throw Error("This read journey must never submit a native action");
      },
    },
  );
  let search = new URLSearchParams(),
    cursor = 0,
    generation = 0;
  const addresses = [search];
  const listeners = new Set<() => void>();
  const address = {
    read: () => new URLSearchParams(search),
    write(next: URLSearchParams, intent?: "push" | "replace") {
      search = new URLSearchParams(next);
      if (intent === "push") {
        addresses.splice(cursor + 1);
        addresses.push(search);
        cursor++;
      } else addresses[cursor] = search;
      listeners.forEach((notify) => notify());
    },
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  };
  let hold: ReturnType<typeof gate> | undefined;
  const pending = new Set<Promise<void>>();
  const source: UseSource = {
    kind: "use",
    open(ctx, deliver) {
      const args = ctx.args as { fan: string[] };
      const delayed = hold;
      hold = undefined;
      const task = host
        .send(++generation, args.fan, delayed, `mounted-${generation}`)
        .then((packet) => {
          // Deliberately deliver after abort too: the real mount must reject the obsolete frame.
          deliver({ kind: "complete", value: packet, revision: packet.version });
        });
      pending.add(task);
      void task.finally(() => pending.delete(task));
      return () => {};
    },
  };
  const input = {
    target: { kind: "document" as const, ref },
    fixture: null,
    work: { address: path, open: ref },
    address,
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
    vi.waitFor(
      () => expect(mount.value(), "mounted publication").toMatchObject({ current: true }),
      { timeout: 20_000 },
    );
  const fan = (mark: string) => {
    const row = first.value!.data.fans.rows.find((row) => row.mark === mark)!;
    return { kind: "ids", ids: [stableFanKey(row)] };
  };
  return {
    host,
    mount,
    input,
    fingerprint,
    work,
    source,
    ready,
    fan,
    delay() {
      hold = gate();
      return hold;
    },
    async settle() {
      await Promise.all([...pending]);
    },
    visit(index: number) {
      cursor = index;
      search = addresses[index]!;
      listeners.forEach((notify) => notify());
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

test("J1 open Fans, choose a subject, carry pose through Back/Forward and share the address", async () => {
  const j = await journey();
  try {
    await j.ready();
    j.mount.page.subject(j.fan("MUAS-1"));
    j.mount.page.pose({ contextRadiusFt: 23 });
    j.mount.page.select([{ kind: "focus", id: "chosen-cell" }]);
    expect(
      [...j.input.address.read().keys()].sort(),
      "B01: Work contents stay out of the link",
    ).toEqual(["contextRadiusFt", "fan", "selected"]);
    const selectedPage = j.mount.page.read();
    j.mount.page.subject(j.fan("FC-23"));
    await j.ready();
    j.visit(1);
    expect(j.mount.page.read(), "B01: Back restores the subject and pose together").toEqual(
      selectedPage,
    );
    j.visit(2);
    expect(j.mount.page.read().fan, "B01: Forward restores the second subject").toEqual(
      j.fan("FC-23"),
    );
    const shared = mountTypedRoute(
      fans,
      { ...j.input, memory: () => ({ contextRadiusFt: 99 }) },
      j.fingerprint,
      { work: j.work, sources: { "fans.sheet": j.source } },
    );
    try {
      expect(shared.page.read(), "B01: a shared URL overrides remembered pose").toEqual(
        j.mount.page.read(),
      );
      shared.page.subject({ kind: "ids", ids: [] });
      expect(shared.page.read().fan, "B01/B03: explicit none survives URL decode").toEqual({
        kind: "ids",
        ids: [],
      });
    } finally {
      shared.dispose();
    }
  } finally {
    await j.close();
  }
}, 60_000);

test("JM B01 move a typed Page while URL custody waits for the router, then share and restore it", async () => {
  const j = await journey();
  try {
    await j.ready();
    let current = true;
    const address = { ...j.input.address, write(next: URLSearchParams, intent?: "push" | "replace") {
      j.input.address.write(next, intent); current = false;
    } };
    const mount = mountTypedRoute(fans, { ...j.input, address, custody: { current: () => current } }, j.fingerprint,
      { work: j.work, sources: { "fans.sheet": j.source } });
    try {
      mount.subscribe(() => {});
      mount.page.subject(j.fan("MUAS-1"));
      expect(mount.page.read().fan, "B01: its own URL write cannot suppress the visible move").toEqual(j.fan("MUAS-1"));
      current = true;
      const restored = mountTypedRoute(fans, j.input, j.fingerprint, { work: j.work, sources: { "fans.sheet": j.source } });
      try { expect(restored.page.read().fan).toEqual(mount.page.read().fan); } finally { restored.dispose(); }
    } finally { mount.dispose(); }
  } finally { await j.close(); }
}, 60_000);

test("JM H18 open core and roster together, switch fan and retain both host publications", async () => {
  const j = await journey();
  try {
    await j.ready();
    const roster = fans.spec.reads!.roster;
    await vi.waitFor(() => expect(j.mount.value(roster).current, "H18: roster survives concurrent core demand").toBe(true));
    j.mount.page.subject(j.fan("MUAS-1"));
    await j.ready();
    expect(j.mount.value(roster).current, "H18: selected core cannot supersede the roster").toBe(true);
    expect(j.mount.value(roster).value.rows.length).toBeGreaterThan(1);
    expect(j.mount.value().value.opened.length, "H18: core retains its own selected scope").toBe(1);
    const point = historyPointSchema.parse(await j.host.history("", { kind: "captured", document: path }));
    expect(point.history.publications.filter(p => p.read === "fans.sheet").length,
      "H18: shared operation records both distinct argument publications").toBeGreaterThanOrEqual(2);
  } finally { await j.close(); }
}, 60_000);

test("J2 switch a subject while its answer is delayed, then hide and return", async () => {
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.ready();
    const old = j.mount.value().value;
    held = j.delay();
    j.mount.page.subject(j.fan("MUAS-1"));
    await held.entered.promise;
    expect(j.mount.value(), "B05: keep the last answer while the new subject waits").toMatchObject({
      current: false,
      status: "pending",
      value: old,
    });
    j.mount.page.subject(j.fan("FC-23"));
    await j.ready();
    const current = j.mount.value();
    held.release.resolve();
    await j.settle();
    await vi.waitFor(() =>
      expect(j.mount.value(), "B06: old generation cannot replace the new pane").toEqual(current),
    );
    j.mount.release();
    expect(j.mount.value().value, "B05: hide retains the answer").toEqual(current.value);
    const resume = j.mount.subscribe(() => {});
    try {
      await j.ready();
      expect(j.mount.page.read().fan, "B07: return retains route intent").toEqual(j.fan("FC-23"));
    } finally {
      resume();
    }
  } finally {
    held?.release.resolve();
    await j.close();
  }
}, 60_000);

test("J3 publish a sheet, capture History, choose another fan and reopen the older point", async () => {
  const host = await fixture(true);
  try {
    const original = await host.send(100, []);
    const point = historyPointSchema.parse(
      await host.history("", { kind: "captured", document: path }),
    );
    const row = original.value!.data.fans.rows.find((row) => row.mark === "MUAS-1")!;
    await host.send(101, [stableFanKey(row)]);
    const calls = host.nativeCalls;
    const restored = await host.send(102, [], undefined, "history-reader", false, point.id);
    expect(restored, "H18: History names the exact host publication").toEqual({
      ...original,
      generation: 102,
    });
    expect(host.nativeCalls, "H09/H18: History does not fill from native").toBe(calls);
    const gap = await host
      .send(103, [], undefined, "history-reader", false, "missing-point")
      .catch((error) => error);
    expect(gap, "H18: a missing point cannot invent a publication").toBeInstanceOf(Error);
  } finally {
    await host.close();
  }
}, 60_000);

test("J4 refresh Fans while the document changes and inspect the retained answer", async () => {
  const j = await journey();
  let held: ReturnType<typeof gate> | undefined;
  try {
    await j.ready();
    const roster = await j.host.send(100, []);
    const row = roster.value!.data.fans.rows.find((row) => row.mark === "MUAS-1")!;
    const selected = [stableFanKey(row)];
    const before = await j.host.send(101, selected);
    held = j.host.holdNative();
    const refresh = j.host.send(102, selected);
    await held.entered.promise;
    j.host.changed();
    held.release.resolve();
    const result = await refresh;
    expect(result.state, "H05: mixed document basis is never current").toBe("refresh-needed");
    expect(result.value!.evaluation, "H05: retain the labelled previous publication").toBe(
      before.value!.evaluation,
    );
    expect(result.value!.freshness, "H05: retained data admits it needs refresh").toBe(
      "refresh-needed",
    );
  } finally {
    held?.release.resolve();
    await j.close();
  }
}, 60_000);

test("J5 open a document read then attempt host and malformed targets without widening access", async () => {
  const unregister = registeredReads.reads.has(fansSheet.name) ? () => {} : registeredReads.register({ sheet: fansSheet });
  const j = await journey();
  try {
    await j.ready();
    const calls = j.host.nativeCalls;
    for (const target of [{ kind: "host" }, { kind: "document", ref: { session: ref.session } }]) {
      const response = await j.host.probe({
        read: "fans.sheet",
        subscription: "bad-target",
        generation: 1,
        args: { target, fan: [], sheetPath: "" },
      });
      expect(response.ok, "H17: invalid document lifetime refuses at HTTP").toBe(false);
      expect(j.host.nativeCalls, "H17: refusal occurs before native dispatch").toBe(calls);
    }
    const response = await j.host.probe({
      read: "fans.sheet",
      subscription: "valid-target",
      generation: 1,
      args: { target: ref, fan: [], sheetPath: "" },
    });
    expect(response.status, `H17: the selected document remains readable: ${await response.clone().text()}`).toBe(200);
    expect(await response.json()).toMatchObject({ state: "current" });
  } finally {
    await j.close();
    unregister();
  }
}, 60_000);
