import { expect, test } from "vite-plus/test";
import { z } from "zod";
import { resourceResponse, type ResourceObserver } from "@pe/runtime";
import { Publications } from "../src/reads/publications.ts";
import { read, type InputPort } from "../src/reads/evaluator.ts";

const definition = read("connection-probe", { input: z.number(), output: z.number(), run: (_ctx, n) => n });
const port: InputPort = { evaluation: "connection", origin: {}, revision: () => 0, take: async () => null };
function fixture(capacity = 4) {
  const publications = new Publications(capacity);
  const observe: ResourceObserver = (request) => {
    if (request.kind !== "publication") throw Error("Expected publication");
    return publications.observe(request.subscription, () => {});
  };
  const connect = (ids: string[]) => {
    const url = new URL("http://host/pe/resources");
    url.searchParams.set("keys", JSON.stringify(ids.map(subscription => ({ kind: "publication", subscription, generation: 0 }))));
    return resourceResponse(new Request(url), observe);
  };
  const publish = (id: string) => publications.publish(id, 0, definition, 1, port);
  return { publications, connect, publish };
}

test("D37 disconnect without explicit releases returns every slot to a new client", async () => {
  const f = fixture();
  const old = f.connect(["a", "b", "c", "d"]);
  const next = f.connect(["e", "f", "g", "h"]);
  try {
    for (const id of ["a", "b", "c", "d"]) expect((await f.publish(id)).state).toBe("current");
    await expect(f.publish("e")).rejects.toThrow("Read subscription capacity reached");
    await old.body!.cancel();
    for (const id of ["e", "f", "g", "h"]) expect((await f.publish(id)).state).toBe("current");
  } finally { await old.body!.cancel(); await next.body!.cancel(); }
});

test("D37 reload with newly minted subscription IDs does not double-count the page", async () => {
  const f = fixture(1);
  const old = f.connect(["old-page"]);
  await f.publish("old-page");
  await old.body!.cancel();
  const next = f.connect(["new-page"]);
  try {
    expect((await f.publish("new-page")).state).toBe("current");
    expect(Object.keys(f.publications.history())).toEqual(["new-page"]);
  } finally { await next.body!.cancel(); }
});

test("D37 a live holder survives another connection closing and capacity pressure", async () => {
  const f = fixture(2);
  const first = f.connect(["live", "retired"]), second = f.connect(["live", "new"]);
  try {
    const value = await f.publish("live");
    await f.publish("retired");
    await first.body!.cancel();
    expect((await f.publish("new")).state).toBe("current");
    await expect(f.publish("other")).rejects.toMatchObject({ problem: "read.subscription-capacity" });
    expect(f.publications.publication("live")).toEqual(value);
    expect((await f.publish("live")).state).toBe("current");
  } finally { await first.body!.cancel(); await second.body!.cancel(); }
});

test("D37 a disconnected input-open admission cannot resurrect its slot after reload", async () => {
  const f = fixture(1);
  const old = f.connect(["same"]);
  const admission = f.publications.admission("same", 0);
  await old.body!.cancel();
  const next = f.connect(["same"]);
  try {
    expect((await f.publications.publish("same", 0, definition, 1, port, undefined, admission)).state).toBe("superseded");
    expect((await f.publish("same")).state).toBe("current");
  } finally { await next.body!.cancel(); }
});

test("D37 HTTP-only reads release their slots when the request finishes", async () => {
  const f = fixture(1);
  expect((await f.publish("one")).state).toBe("current");
  expect((await f.publish("two")).state).toBe("current");
  expect(f.publications.history()).toEqual({});
});
