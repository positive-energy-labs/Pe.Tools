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

test("a context.missing POST reloads at most once per 30 seconds and preserves the body", async () => {
  const reload = vi.fn();
  const body = { error: { code: "context.missing", message: "anonymous callers are read-only" } };
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(body, { status: 403 })),
  );
  const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
  sessionStorage.clear();
  try {
    const response = await hostFetch("/pe/threads", { method: "POST" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual(body);
    clock.mockReturnValue(129_999);
    await hostFetch("/pe/threads", { method: "POST" });
    expect(reload).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(130_000);
    await hostFetch("/pe/threads", { method: "POST" });
    expect(reload).toHaveBeenCalledTimes(2);
  } finally {
    sessionStorage.clear();
    clock.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("GET and other refusal codes never reload", async () => {
  const reload = vi.fn();
  const fetcher = vi.fn(async () =>
    Response.json({ error: { code: "context.missing" } }, { status: 403 }),
  );
  vi.stubGlobal("window", { location: { reload } });
  vi.stubGlobal("fetch", fetcher);
  sessionStorage.clear();
  try {
    await hostFetch("/pe/threads");
    await hostFetch("/pe/threads", { method: "GET" });
    fetcher.mockImplementation(async () =>
      Response.json({ error: { code: "grant.missing" } }, { status: 403 }),
    );
    await hostFetch("/pe/threads", { method: "POST" });
    expect(reload).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
  } finally {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  }
});
