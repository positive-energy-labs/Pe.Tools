import { expect, test, vi } from "vite-plus/test";
import { readingKey, type ReadingRequest } from "@pe/agent-contracts";
import { resourceResponse, updateResourceSubscriptions, type ResourceObserver } from "@pe/runtime";

test("one connection accepts bounded subscription batches, deduplicates and releases", async () => {
  const active = new Set<string>();
  const observe: ResourceObserver = vi.fn((request) => {
    const key = readingKey(request);
    active.add(key);
    return () => {
      active.delete(key);
    };
  });
  const first = { kind: "host-status" } as const;
  const url = new URL("http://host/pe/resources?connection=page");
  url.searchParams.set("keys", JSON.stringify([first]));
  const response = resourceResponse(new Request(url), observe);
  const update = (add: ReadingRequest[], remove: string[] = []) =>
    updateResourceSubscriptions(
      new Request("http://host/pe/resource-subscriptions?connection=page", {
        method: "POST",
        body: JSON.stringify({ add, remove }),
      }),
      observe,
    );
  const rows: ReadingRequest[] = Array.from({ length: 100 }, (_, n) => ({
    kind: "receipts",
    id: String(n),
  }));
  for (let i = 0; i < rows.length; i += 32)
    expect((await update(rows.slice(i, i + 32))).status).toBe(200);
  expect(active.size).toBe(101);
  await update(rows.slice(0, 32));
  expect(observe).toHaveBeenCalledTimes(101);
  for (let i = 0; i < rows.length; i += 32) await update([], rows.slice(i, i + 32).map(readingKey));
  expect(active.size).toBe(1);
  await response.body!.cancel();
  expect(active.size).toBe(0);
  expect((await update([first])).status).toBe(409);
});
