import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { bindWork, refusalText, type WorkWriteAck } from "@pe/agent-contracts";
import { RouteWorkspace } from "../src/route-workspace.ts";
import { createWorkJournal } from "../src/work-journal.ts";
import { createWorkJournal as browserJournal } from "../../../apps/web/src/shell/journal.ts";

function fixture() {
  const key = bindWork("history-proof", null, "one");
  let saved: unknown = null;
  const options = {
    registrations: [
      {
        spec: {
          route: key.route,
          title: "History",
          description: "Proof",
          schema: z.object({ a: z.number().default(0), b: z.number().default(0) }),
        },
      },
    ],
    store: {
      getState: async () => structuredClone(saved),
      setState: async ({ value }: { value: unknown }) => {
        saved = structuredClone(value);
      },
    },
  };
  let host = new RouteWorkspace(options);
  const edit = async (by: "human" | "pea", press: string | null, a: number, b?: number) => {
    const current = await host.view(key, key.route);
    const result = await host.write(key, key.route, by, {
      kind: "apply",
      press,
      expectedRevision: current!.revision,
      patches: [{ path: ["a"], value: a }, ...(b === undefined ? [] : [{ path: ["b"], value: b }])],
    });
    if (!result.ok) throw Error(refusalText(result));
    return result;
  };
  return {
    key,
    edit,
    get host() {
      return host;
    },
    restart() {
      host = new RouteWorkspace(options);
      return host;
    },
  };
}

test("web and Pea share the reducer; a two-write press restores as one step across restart", async () => {
  expect(browserJournal).toBe(createWorkJournal);
  const f = fixture();
  const web = browserJournal(f.key);
  web.accept((await f.edit("human", "two-writes", 1)).write);
  web.accept((await f.edit("human", "two-writes", 2)).write);
  expect(web.read().undo).toHaveLength(1);
  f.restart();
  expect(await f.host.step(f.key, f.key.route, "pea", "undo", 2)).toMatchObject({
    ok: true,
    revision: 4,
    doc: { a: 0 },
  });
  const replayed: WorkWriteAck[] = [];
  const stop = f.host.observeAccepted(f.key, (ack) => {
    replayed.push(ack);
    web.accept(ack);
  });
  await f.host.view(f.key, f.key.route); // waits behind serialized replay
  expect(web.read().undo).toHaveLength(0);
  expect(web.read().redo).toHaveLength(1);
  expect(web.read().moves.map(({ kind }) => kind)).toEqual(["apply", "apply", "undo"]);
  stop();
  f.restart();
  expect(await f.host.step(f.key, f.key.route, "human", "redo", 4)).toMatchObject({
    ok: true,
    revision: 6,
    doc: { a: 2 },
  });
  expect(
    replayed.filter(({ kind }) => kind === "restore").map(({ restoreOf }) => restoreOf),
  ).toEqual([2, 1]);
});

test("durable replay exceeds 100 writes, deduplicates delivery, and scopes equal presses by author", async () => {
  const f = fixture();
  await f.edit("human", "same", 1);
  await f.edit("pea", "same", 2);
  for (let i = 3; i <= 131; i++) await f.edit("pea", null, i);
  f.restart();
  const web = browserJournal(f.key);
  const stop = f.host.observeAccepted(f.key, (ack) => {
    web.accept(ack);
    web.accept(ack);
  });
  await f.host.view(f.key, f.key.route);
  expect(web.read().moves).toHaveLength(131);
  expect(web.read().undo).toHaveLength(131);
  expect(
    web
      .read()
      .undo.slice(0, 2)
      .map(({ id }) => id),
  ).toEqual(["human:same", "pea:same"]);
  expect(web.read().moves[0]).toMatchObject({ revision: 1, by: "human" });
  stop();
});

test("restore identity is exact even when inverse patches repeat; missing identity refuses", async () => {
  const f = fixture();
  const first = await f.edit("human", "one", 1);
  await f.edit("human", "two", 0);
  const third = await f.edit("human", "three", 1);
  expect(third.write.inverse).toEqual(first.write.inverse);
  const unknown = await f.host.write(f.key, f.key.route, "pea", {
    kind: "restore",
    press: null,
    patches: third.write.inverse,
    expectedRevision: 3,
  });
  expect(unknown.ok).toBe(false);
  const result = await f.host.step(f.key, f.key.route, "pea", "undo", 3);
  expect(result).toMatchObject({
    ok: true,
    write: { restoreOf: 3, step: "human:three" },
    doc: { a: 0 },
  });
});

test("a durable publish remains a barrier after restart even when values return", async () => {
  const f = fixture();
  await f.edit("human", "edit", 1);
  await f.host.publish(f.key, f.key.route, [{ path: ["a"], value: 2 }], 1);
  await f.host.publish(f.key, f.key.route, [{ path: ["a"], value: 1 }], 2);
  f.restart();
  expect((await f.host.step(f.key, f.key.route, "pea", "undo", 3)).ok).toBe(false);
  expect(await f.host.view(f.key, f.key.route)).toMatchObject({ revision: 3, doc: { a: 1 } });
});
