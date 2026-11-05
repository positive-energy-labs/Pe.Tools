import { expect, test, vi } from "vite-plus/test";
import { withInvocationContext } from "@pe/runtime/context";
import { ductsNativeRead } from "../src/ducts-analysis.ts";
import { currentCaller } from "../src/control.ts";
import { nativeFixture } from "./fans-native.fixture.ts";
import { human, pea } from "./callers.ts";

test("the analysis adapter carries its actual caller through the retained Read door", async () => {
  const f = await nativeFixture();
  // Substitute only HTTP transport; the existing fixture composes the real request services and bridge.
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    f.request(new Request(input, init), currentCaller()),
  );
  const call = ductsNativeRead("http://fixture");
  const read = (caller: Parameters<typeof f.request>[1]) =>
    withInvocationContext({ hostBaseUrl: "http://fixture", caller }, () =>
      call("ducts.snapshot.walk", { selector: { kind: "ids", ids: [1] } }, f.target.ref),
    );
  try {
    const agent = await read(pea("analysis-fixture"));
    expect(agent.status, await agent.clone().text()).toBe(200);
    const nativeId = agent.headers.get("x-pe-native-request-id");
    expect(nativeId).toMatch(/^[0-9a-f-]{36}$/);
    const retained = await read(human);
    expect(retained.status, await retained.clone().text()).toBe(200);
    expect(retained.headers.get("x-pe-native-request-id")).toBe(nativeId);
    expect(retained.headers.get("x-pe-ducts-reused")).toBe("true");
    const anonymous = await read({ kind: "anonymous" });
    expect(anonymous.status).toBe(403);
    expect(anonymous.headers.get("x-pe-native-request-id")).toBeNull();
    expect(f.dispatched.filter((row) => row.key === "ducts.snapshot.walk")).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    await f.close();
  }
});
