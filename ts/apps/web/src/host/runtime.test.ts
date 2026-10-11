// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { hostFetch, runtimeStreamUrl } from "./runtime";

test("HTTP and SSE retain the page's build owner across a changed destination", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response());
  vi.stubGlobal("fetch", fetcher);
  try {
    await hostFetch("http://127.0.0.1:9999/call", {
      method: "POST",
      headers: { "content-type": "application/json", "x-pe-runtime-service": "foreign" },
    });
    const headers = fetcher.mock.calls[0]![1].headers as Headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-pe-runtime-service")).toBe(import.meta.env.PE_RUNTIME_SERVICE);
    const stream = new URL(
      runtimeStreamUrl("http://127.0.0.1:9998/pe/readings?keys=a&peRuntimeService=foreign"),
    );
    expect(stream.searchParams.get("keys")).toBe("a");
    expect(stream.searchParams.getAll("peRuntimeService")).toEqual([
      import.meta.env.PE_RUNTIME_SERVICE,
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
