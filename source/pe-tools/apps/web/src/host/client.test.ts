import { expect, test } from "vite-plus/test";
import { HOST_RPC_BRIDGE_SESSION_HEADER } from "@pe/host-contracts/operation-types";
import { callHostDynamic } from "./client.ts";

test("web host calls preserve the explicit bridge session selector", async () => {
  const originalFetch = globalThis.fetch;
  let headers = new Headers();
  globalThis.fetch = async (_input, init) => {
    headers = new Headers(init?.headers);
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await callHostDynamic("revit.context.summary", {}, { bridgeSessionId: "sandbox:source-e2e" });
    expect(headers.get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe("sandbox:source-e2e");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
