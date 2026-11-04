import { expect, test, vi } from "vite-plus/test";
import { createReadFetch } from "./read-fetch";

test("geometry representation and reach payloads never join, in either order", async () => {
  const payloads = [
    { contextRepresentation: "link-boxes", reach: "selection" },
    { contextRepresentation: "meshes", reach: "selection" },
    { contextRepresentation: "meshes", reach: "document" },
  ];
  for (const order of [payloads, [...payloads].reverse()]) {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) =>
      Response.json(JSON.parse(init!.body as string)),
    );
    const read = createReadFetch(fetcher);
    const responses = await Promise.all(
      order.map((body) =>
        read("/geometry", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(order.length);
    expect(await Promise.all(responses.map((response) => response.json()))).toEqual(order);
    // A body is never omitted from a join key, even for a nonstandard GET supplied by a caller.
    await Promise.all(order.map((body) => read("/geometry", { body: JSON.stringify(body) })));
    expect(fetcher).toHaveBeenCalledTimes(order.length * 2);
  }
});

test("bodyless GETs with different representation or reach queries do not join", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) => Response.json({ url }));
  const read = createReadFetch(fetcher);
  const urls = [
    "/geometry?contextRepresentation=link-boxes&reach=selection",
    "/geometry?contextRepresentation=meshes&reach=selection",
    "/geometry?contextRepresentation=meshes&reach=document",
  ];
  const responses = await Promise.all(urls.map((url) => read(url, {})));
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(await Promise.all(responses.map((response) => response.json()))).toEqual(
    urls.map((url) => ({ url })),
  );
});

test("one GET per identity, independent bodies and cancellation, no cache after completion", async () => {
  let answer!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const read = createReadFetch(fetcher);
  const cancelled = new AbortController();
  const first = read("/reading", { signal: cancelled.signal });
  const rejected = expect(first).rejects.toThrow();
  cancelled.abort();
  const second = read("/reading", {});
  const third = read("/reading", {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  answer(Response.json({ kept: true }));
  await rejected;
  expect(await (await second).json()).toEqual({ kept: true });
  expect(await (await third).json()).toEqual({ kept: true });
  const next = read("/reading", {});
  expect(fetcher).toHaveBeenCalledTimes(2);
  answer(new Response());
  await next;
});

test("different headers and writes do not share a flight; last cancellation releases transport", async () => {
  const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
  const read = createReadFetch(fetcher);
  const controller = new AbortController();
  const pending = read("/reading", { signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow();
  void read("/reading", { headers: { target: "other" } });
  void read("/reading", { method: "POST" });
  void read("/reading", { method: "POST" });
  expect(fetcher).toHaveBeenCalledTimes(4);
  controller.abort();
  await rejected;
  expect(fetcher.mock.calls[0]![1]!.signal!.aborted).toBe(true);
});
