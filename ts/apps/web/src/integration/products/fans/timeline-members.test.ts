import { afterEach, expect, test, vi } from "vite-plus/test";
import type { WorkKey } from "@pe/agent-contracts";
import { hostTimeline } from "../../../../../host/src/reads/work-timeline.ts";
import type { TimelineClient } from "../../../shell/work-feed-client.ts";
import { createWitness } from "../../../../tests/integration/products/fans/cutover.test-support.ts";
import { elementSubject } from "@pe/ducts-domain/work-subject";
import { snapshot } from "@pe/ducts-domain/test-fixture";
import { module as chat } from "../../../chat/route.ts";
import { mountTypedRoute } from "../../../shell/typed-mount.ts";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { z } from "zod";

const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

test("D25: /fans Timeline names Fans, Ducts, Ducts for undo, undo, redo", async () => {
  let host: ReturnType<typeof hostTimeline> | undefined;
  const listeners = new Set<() => Promise<void>>();
  const timeline: TimelineClient = {
    open(works, deliver, document) {
      let closed = false;
      const refresh = async () => {
        if (!host) return;
        const value = await host.read(works, "human", document);
        if (!closed) deliver(value);
      };
      listeners.add(refresh);
      void refresh();
      return () => {
        closed = true;
        listeners.delete(refresh);
      };
    },
    async step(request) {
      if (!host) throw Error("Host fixture not connected");
      const result = await host.step(request, { kind: "human", via: "local" }, "human");
      await Promise.all([...listeners].map((refresh) => refresh()));
      return result && typeof result === "object" && "ok" in result && result.ok
        ? null
        : { message: JSON.stringify(result) };
    },
  };
  const f = await createWitness(
    closes,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    timeline,
  );
  host = hostTimeline(f.ws, async () => []);
  await vi.waitFor(() => expect(f.owner.workBasis()).toBeTruthy());
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  const ducts = f.owner.work()!.handle.key;
  const fans = f.fans.work()!.handle.key;
  const fan = elementSubject(snapshot.nodes.find((node) => node.id === 4)!);
  const edit = async (key: WorkKey, path: string[], value: unknown, label: string) => {
    const view = await f.ws.view(key, key.route);
    expect(
      await f.ws.write(
        key,
        key.route,
        "human",
        {
          kind: "apply",
          expectedRevision: view!.revision,
          press: crypto.randomUUID(),
          patches: [{ path, value: { edit: { value } } }],
          label,
        },
        async () => [],
      ),
    ).toMatchObject({ ok: true });
    await Promise.all([...listeners].map((refresh) => refresh()));
    // Work chronology is timestamp ordered, as in the existing host door fixture.
    await new Promise((resolve) => setTimeout(resolve, 3));
  };
  await edit(ducts, ["velocitySupplyFpm"], 925, "Ducts supply velocity 925");
  await edit(fans, ["equipmentFlows", fan], 1234, "Fans airflow 1234");
  // A newer edit in a Work /fans never reads must not compete with either step.
  const schedules = { ...fans, route: "schedules" };
  closes.push(
    f.ws.register({
      spec: {
        route: "schedules",
        title: "Schedules",
        description: "Unread Work",
        schema: z.object({ n: z.number() }),
      },
    }),
  );
  f.saved.set("schedules", { version: 1, schemaVersion: 1, revision: 0, doc: { n: 0 } });
  expect(
    await f.ws.write(
      schedules,
      "schedules",
      "human",
      {
        kind: "apply",
        expectedRevision: 0,
        press: crypto.randomUUID(),
        patches: [{ path: ["n"], value: 1 }],
        label: "Unread Schedules edit",
      },
      async () => [],
    ),
  ).toMatchObject({ ok: true });
  await Promise.all([...listeners].map((refresh) => refresh()));
  expect((await host.read([schedules], "human")).undo).toMatchObject({ work: schedules });
  expect(
    f.typed.timeline()?.rows.some((row) => "work" in row && row.work?.route === "schedules"),
  ).toBe(false);
  const before = (await f.ws.view(ducts, "duct-systems"))!.doc;
  // Control: the real host has the Ducts edit when given both Work keys.
  expect((await host.read([ducts], "human")).undo).toMatchObject({ work: ducts });
  for (const [direction, work] of [
    ["undo", fans],
    ["undo", ducts],
    ["redo", ducts],
  ] as const) {
    expect(f.typed.timeline()?.[direction]).toMatchObject({ work });
    expect(await f.typed.stepTimeline(direction)).toBeNull();
    if (work === ducts) {
      const doc = (await f.ws.view(ducts, "duct-systems"))!.doc;
      if (direction === "undo") expect(doc).not.toEqual(before);
      else expect(doc).toEqual(before);
    }
  }
  // Revealing a retained Place must reconnect even when its membership did not change.
  f.typed.release();
  expect(f.typed.timeline()).toBeNull();
  closes.push(f.typed.subscribe(() => {}));
  await vi.waitFor(() => expect(f.typed.timeline()?.undo).toMatchObject({ work: ducts }));
});

test("D25: document-bound Pea opens document Timeline without editable owners", () => {
  const open = vi.fn(() => () => {});
  const mount = mountTypedRoute(
    chat,
    {
      address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
      fixture: null,
      target: { kind: "document", ref: { session: "proof", openId: "document" } },
      work: { address: null, open: { session: "proof", openId: "document" } },
      custody: { current: () => true },
      memory: () => ({}),
    },
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    {
      timeline: { open, step: async () => null },
      sources: { [chat.spec.core!.key]: { kind: "use", open: () => () => {} } },
    },
  );
  try {
    expect(mount.target()?.kind).toBe("document");
    expect(mount.spec.edits).toBeUndefined();
    expect(open).toHaveBeenCalledWith([], expect.any(Function), {
      route: "chat",
      binding: "open",
      target: null,
      open: { session: "proof", openId: "document" },
    });
    expect(mount.timeline()).toBeNull();
  } finally {
    mount.dispose();
  }
});
