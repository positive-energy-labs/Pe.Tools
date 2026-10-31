import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { requestJson } from "./readings-api";

const fetched = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock("../host/runtime", () => ({ hostFetch: fetched.host }));
afterEach(() => fetched.host.mockReset());

const ok = () => Promise.resolve(new Response(JSON.stringify({ n: 1 })));
const signal = new AbortController().signal;
const schema = z.object({ n: z.number() });

test("requestJson carries the headers a route-scoped read names, beside the JSON content type", async () => {
  fetched.host.mockImplementation(ok);
  await requestJson(
    { path: "/p", body: { a: 1 }, headers: { "x-document": "open-1" } },
    schema,
    signal,
  );
  expect(fetched.host).toHaveBeenCalledWith("/p", {
    method: "POST",
    headers: { "content-type": "application/json", "x-document": "open-1" },
    body: '{"a":1}',
    signal,
  });
});

test("a bodyless request keeps its GET and still sends its headers", async () => {
  fetched.host.mockImplementation(ok);
  await requestJson({ path: "/p", headers: { "x-document": "open-1" } }, schema, signal);
  expect(fetched.host).toHaveBeenCalledWith("/p", {
    headers: { "x-document": "open-1" },
    signal,
  });
  await requestJson({ path: "/p" }, schema, signal);
  expect(fetched.host).toHaveBeenLastCalledWith("/p", { signal });
});
