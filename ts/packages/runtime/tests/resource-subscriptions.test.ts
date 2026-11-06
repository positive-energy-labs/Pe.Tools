import { expect, test, vi } from "vite-plus/test";
import { readingKey } from "@pe/agent-contracts";
import { resourceResponse, updateResourceSubscriptions, type ResourceObserver } from "../src/resource-stream.ts";

test("subscription updates preserve caller ownership without any recording or ACK policy", async () => {
  const stop = vi.fn();
  const observe: ResourceObserver = vi.fn(() => stop);
  const response = resourceResponse(new Request("http://host/pe/resources?connection=owned"), observe, undefined, observe, undefined, "caller-A");
  const reader = response.body!.getReader();
  const request = { kind: "machine" } as const;
  const update = (owner: string, add: unknown[], remove: string[]) => updateResourceSubscriptions(new Request("http://host/pe/resource-subscriptions?connection=owned", {
    method: "POST", body: JSON.stringify({ add, remove }),
  }), observe, owner);
  try {
    expect((await update("caller-B", [request], [])).status).toBe(400);
    expect(observe).not.toHaveBeenCalled();
    expect((await update("caller-A", [request], [])).status).toBe(200);
    expect(observe).toHaveBeenCalledOnce();
    expect((await update("caller-B", [], [readingKey(request)])).status).toBe(400);
    expect(stop).not.toHaveBeenCalled();
  } finally { await reader.cancel(); }
  expect(stop).toHaveBeenCalledOnce();
  expect((await update("caller-A", [request], [])).status).toBe(409);
});
