// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { webBuildStamp } from "./build-stamp";
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
    expect(headers.get("x-pe-web-build")).toBe(webBuildStamp.build);
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

test("the browser contextFetch carries the runtime owner to its own origin and to no other", async () => {
  const { contextFetch } =
    await import("../../../../packages/runtime/src/invocation-context.browser");
  const fetcher = vi.fn().mockResolvedValue(new Response());
  vi.stubGlobal("fetch", fetcher);
  try {
    await contextFetch("/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    await contextFetch(`${location.origin}/actions/cancel`, { method: "POST" });
    await contextFetch("https://example.com/docs.json");
    const sent = fetcher.mock.calls.map(
      ([, init]) => (init?.headers as Headers | undefined)?.get("x-pe-runtime-service") ?? null,
    );
    // Without it the host answers runtime.owner-missing, or reads the call as anonymous.
    expect(sent).toEqual([
      import.meta.env.PE_RUNTIME_SERVICE,
      import.meta.env.PE_RUNTIME_SERVICE,
      null,
    ]);
    expect((fetcher.mock.calls[0]![1].headers as Headers).get("content-type")).toBe(
      "application/json",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
