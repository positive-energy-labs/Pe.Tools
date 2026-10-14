import { expect, test } from "vite-plus/test";
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import { hostOwnership } from "../src/host-ownership.ts";
import { bootHost } from "./real-server.ts";

/**
 * ADR 0017 D1: anonymous transport is read-only, so reads are admitted. The add-in calls back into
 * the host with no context (`TsHostCallClient`: pod.list, pod.capture, settings reads), and every
 * native script died on `context.missing` when /call refused every anonymous caller.
 */
test("an anonymous local call reads host-local state; a Mutate op is still not dispatched", async () => {
  const host = await bootHost();
  try {
    const post = (key: string, request: unknown = {}) =>
      fetch(`${host.base}/call`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HOST_RUNTIME_SERVICE_HEADER]: hostOwnership.serviceName,
        },
        body: JSON.stringify({ key, request }),
      });
    const read = await post("pod.list");
    expect([read.status, await read.text()]).toEqual([200, expect.stringContaining("pods")]);
    // A Mutate op is never raw-dispatched to /call, whoever asks.
    const mutation = await post("host.shell.open", { path: "C:/" });
    expect(mutation.status).toBe(409);
    expect(await mutation.text()).toMatch(/\/actions/);
  } finally {
    await host.close();
  }
}, 30_000);
