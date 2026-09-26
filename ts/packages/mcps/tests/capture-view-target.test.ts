import { address, turnContextKey } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { expect, test } from "vite-plus/test";
import { configurePeaProductToolContext } from "../src/pea/capability-tools.ts";
import { peaProductTools } from "../src/pea/index.ts";

test("capture_view forwards the frozen exact open lifetime and never invents one", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Headers[] = [];
  configurePeaProductToolContext({ hostBaseUrl: "http://capture-view-target.test" });
  globalThis.fetch = async (input, init) => {
    const path = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    ).pathname;
    if (path === "/ops")
      return Response.json({
        operations: [{ key: "revit.context.view-image", intent: "Read", needs: "document" }],
      });
    if (path !== "/call") throw Error(`unexpected request ${path}`);
    calls.push(new Headers(init?.headers));
    return Response.json(
      { message: "A matching exact open document lifetime is required" },
      { status: 409 },
    );
  };
  try {
    const run = (defaultTarget: unknown) =>
      peaProductTools.capture_view.execute!(
        {
          target: { name: "Coordination Plan - Level 3-Attic" },
          marginPercent: 10,
          pixelSize: 1800,
        },
        {
          requestContext: {
            [turnContextKey]: {
              id: "11111111-1111-4111-8111-111111111111",
              thread: "capture-view",
              revision: 1,
              defaultTarget,
            },
          },
        } as never,
      );
    await run({ kind: "open", ref: { session: "session-a", openId: "open-a" } });
    await run({ kind: "named", session: "session-a", address: address("C:\\Models\\Chadds.rvt") });
    await run(null);
    expect(calls).toHaveLength(3);
    expect(calls[0].get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe("session-a");
    expect(calls[0].get(HOST_RPC_DOCUMENT_HEADER)).toBe("open-a");
    expect(calls[1].get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe("session-a");
    expect(calls[1].get(HOST_RPC_DOCUMENT_HEADER)).toBeNull();
    expect(calls[2].get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBeNull();
    expect(calls[2].get(HOST_RPC_DOCUMENT_HEADER)).toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    configurePeaProductToolContext({});
  }
});
