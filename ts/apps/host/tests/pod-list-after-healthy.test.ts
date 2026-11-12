import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "../src/host-ownership.ts";
import { listPackages } from "../src/packages.ts";
import { bootHost } from "./real-server.ts";

// The host answers healthy while the shipped-pod import still runs, so the first listing waits for
// it. Alone in its file: the import is memoized per process, and only the first boot runs it.
// Mutant, run red once (2026-11-11): drop `yield* shippedPodsImported(ctx)` from `listPods`.
test("the first pod.list after healthy on a fresh home lists every shipped pod", async () => {
  const shipped = (
    await listPackages(join(hostOwnership.sourceRoot!, "examples", "pods"))
  ).packages.map((pod) => pod.id);
  // The sentinel: the checkout does ship pods to miss.
  expect(shipped.length).toBeGreaterThan(1);
  const host = await bootHost();
  try {
    const response = await fetch(`${host.base}/call`, {
      method: "POST",
      headers: { "content-type": "application/json", [HOST_CONTEXT_HEADER]: host.terminal },
      body: JSON.stringify({ key: "pod.list" }),
    });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const listed = (JSON.parse(text) as { pods: { id: string }[] }).pods.map((pod) => pod.id);
    expect(listed).toEqual(expect.arrayContaining(shipped));
  } finally {
    await host.close();
  }
}, 180_000);
