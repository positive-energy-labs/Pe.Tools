// Review of fa689643: pe.js read boundaries (empty 4xx, typed refusal banner, pe.do probe, buffered headers, null-body statuses).
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { expect, test } from "vite-plus/test";

async function page(send: (key: string, input: any) => Promise<Response>) {
  const source = (await readFile(new URL("../src/pages/pe.js", import.meta.url), "utf8"))
    .replace(
      "/*pe:runtime*/ null",
      JSON.stringify({ header: "x-runtime", query: "runtime", service: "proof" }),
    )
    .replace("/*pe:client*/ null", "__client");
  const nodes: any[] = [];
  let waits = 0;
  const window: any = { addEventListener() {} };
  runInNewContext(source, {
    window,
    location: new URL("http://host/pages/probe/"),
    URL,
    URLSearchParams,
    Response,
    document: {
      querySelector: () => null,
      body: { prepend: (n: any) => nodes.unshift(n) },
      getElementById: (id: string) => nodes.find((n) => n.id === id),
      createElement: () => ({ style: {}, setAttribute() {} }),
    },
    __client: { response: send },
    setTimeout: (ok: () => void) => {
      if (++waits > 3) throw Error("unexpected retry loop");
      ok();
      return 1;
    },
    clearTimeout() {},
  });
  return { pe: window.pe, nodes };
}
test("an empty HTTP 404 retains its status in the error", async () => {
  const { pe } = await page(
    async () => new Response(null, { status: 404, statusText: "Not Found" }),
  );
  const error = await pe.read("optional.read").catch((e: any) => e);
  expect(error.message).toContain("404");
  expect(error.status).toBe(404);
});
test("an untyped JSON 404 poll keeps its status and raises no banner; a typed refusal banners the host words", async () => {
  let calls = 0;
  const { pe, nodes } = await page(async () =>
    ++calls === 1
      ? Response.json({ message: "not yet" }, { status: 404 })
      : Response.json(
          {
            message: "More than 1 MEP systems",
            issues: [{ code: "MepBoundExceeded", path: "$.maxSystems" }],
          },
          { status: 400 },
        ),
  );
  const untyped = await pe.read("poll.read").catch((e: any) => e);
  expect([untyped.name, untyped.message]).toEqual(["Error", "404 : not yet"]);
  expect(nodes.find((n) => n.id === "pe-refusal")).toBeUndefined();
  const typed = await pe.read("poll.read").catch((e: any) => e);
  expect([typed.name, typed.code, typed.message]).toEqual([
    "PeRefusal",
    "MepBoundExceeded",
    "More than 1 MEP systems",
  ]);
  expect(nodes.find((n) => n.id === "pe-refusal")).toMatchObject({
    textContent: "More than 1 MEP systems",
  });
});
test("pe.do consumes its notDispatched409 probe without a refusal banner", async () => {
  const calls: string[] = [];
  const { pe, nodes } = await page(async (key) => {
    calls.push(key);
    return key === "page.call"
      ? Response.json({ notDispatched: true }, { status: 409 })
      : Response.json({ id: "a", state: "succeeded", result: { ok: true } });
  });
  expect(await pe.do("mutate")).toEqual({ ok: true });
  expect(calls).toEqual(["page.call", "page.act"]);
  expect(nodes.find((n) => n.id === "pe-refusal")).toBeUndefined();
});
test("buffered reads retain capture headers", async () => {
  const { pe } = await page(async () =>
    Response.json(
      { ok: true },
      { headers: { "x-pe-capture-url": "/captures/a.png", "x-pe-capture-id": "a" } },
    ),
  );
  expect(await pe.read("capture")).toEqual({
    ok: true,
    captureUrl: "/captures/a.png",
    captureId: "a",
  });
});
test.each([204, 205, 304])(
  "review: buffered text publication handles null-body status %s once",
  async (status) => {
    let calls = 0;
    const { pe } = await page(async (key) => {
      calls++;
      return key === "page.state"
        ? Response.json({ seq: 0, events: [] })
        : new Response(null, { status });
    });
    const result = pe.state({ base: 0, reduce: (s: any) => s });
    if (status === 304) await expect(result).rejects.toThrow("304");
    else expect((await result).state).toBe(0);
    expect(calls).toBe(2);
  },
);
