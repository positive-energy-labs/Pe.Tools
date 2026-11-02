import { expect, test, vi } from "vite-plus/test";
import { createPluginsHandler } from "../src/plugins-handler.ts";
test("GET Pod inventory never refreshes lifecycle or runs setup", async () => {
  const statuses = [{ id: "pod:pipes", status: "active" }];
  const refresh = vi.fn(() => { throw Error("Read attempted lifecycle setup"); });
  const content = { lifecycle: { ready: Promise.resolve(), inventory: () => statuses, refresh } } as unknown as Parameters<typeof createPluginsHandler>[0];
  const routes = {} as Parameters<typeof createPluginsHandler>[1];
  const response = await createPluginsHandler(content, routes)(new Request("http://localhost/pe/plugins"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(statuses);
  expect(refresh).not.toHaveBeenCalled();
});
