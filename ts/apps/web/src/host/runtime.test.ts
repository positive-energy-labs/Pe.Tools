// @vitest-environment jsdom
import { expect, test, vi } from "vite-plus/test";
import { webBuildStamp } from "@pe/web-kernel/host/build-stamp";
import { hostFetch, runtimeStreamUrl } from "@pe/web-kernel/host/runtime";

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

const refusedBody = {
  error: { code: "context.missing", message: "anonymous callers are read-only" },
};
/** The navigation door as the page reaches it: the hidden frame, answered as loaded. */
const answerNavigation = async () => {
  const frame = await vi.waitFor(() => {
    const found = document.querySelector("iframe");
    if (!found) throw Error("no navigation yet");
    return found;
  });
  const seen = { src: frame.src, sandbox: frame.getAttribute("sandbox") };
  frame.dispatchEvent(new Event("load"));
  return seen;
};

test("a write refused context.missing after a host restart re-admits through a navigation and retries, with no reload", async () => {
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload, origin: location.origin, search: "" } });
  let admitted = false;
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) =>
    admitted ? Response.json({ revision: 1 }) : Response.json(refusedBody, { status: 403 }),
  );
  vi.stubGlobal("fetch", fetcher);
  sessionStorage.clear();
  try {
    const write = hostFetch("/pe/route-view/pumps", { method: "PUT", body: '{"a":1}' });
    // The first send is already refused; the host admits what follows the navigation.
    admitted = true;
    const navigation = await answerNavigation();
    // The same door a fresh load uses: a GET navigation of this origin. No script runs in it.
    expect(navigation).toEqual({ src: `${location.origin}/`, sandbox: "allow-same-origin" });
    const response = await write;
    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([, init]) => init.body)).toEqual(['{"a":1}', '{"a":1}']);
    expect(document.querySelector("iframe")).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  } finally {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("a navigation that mints no context falls back to one reload per 30 seconds; anonymous stays refused", async () => {
  const reload = vi.fn();
  vi.stubGlobal("window", { location: { reload, origin: location.origin, search: "" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(refusedBody, { status: 403 })),
  );
  const clock = vi.spyOn(Date, "now").mockReturnValue(100_000);
  sessionStorage.clear();
  const refusedWrite = async () => {
    const write = hostFetch("/pe/threads", { method: "POST" });
    await answerNavigation();
    return write;
  };
  try {
    const response = await refusedWrite();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual(refusedBody);
    expect(reload).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(129_999);
    await refusedWrite();
    expect(reload).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(130_000);
    await refusedWrite();
    expect(reload).toHaveBeenCalledTimes(2);
  } finally {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("GET and other refusal codes never reload", async () => {
  const reload = vi.fn();
  const fetcher = vi.fn(async () =>
    Response.json({ error: { code: "context.missing" } }, { status: 403 }),
  );
  vi.stubGlobal("window", { location: { reload, origin: location.origin, search: "" } });
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
    expect(document.querySelector("iframe")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  } finally {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

/* purge-2 c103cdbc: a write sent while the frame loaded was admitted at once, ahead of the refused write's replay. */
test("a write sent during a re-admission waits for it, so the host receives writes in send order", async () => {
  vi.stubGlobal("window", { location: { reload: vi.fn(), origin: location.origin, search: "" } });
  let admitted = false;
  const received: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      if (!admitted) return Response.json(refusedBody, { status: 403 });
      received.push(init.body);
      return Response.json({ revision: received.length });
    }),
  );
  sessionStorage.clear();
  try {
    const first = hostFetch("/pe/route-view/pumps", { method: "PUT", body: "first" });
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    // The navigation's response headers have minted the context; its `load` has not fired yet.
    admitted = true;
    const second = hostFetch("/pe/route-view/pumps", { method: "PUT", body: "second" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await answerNavigation();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(received).toEqual(["first", "second"]);
  } finally {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});

test("the admission layer's { refusal } envelope re-admits as the { error } one does", async () => {
  vi.stubGlobal("window", { location: { reload: vi.fn(), origin: location.origin, search: "" } });
  let admitted = false;
  const fetcher = vi.fn(async () =>
    admitted
      ? Response.json({ revision: 1 })
      : Response.json(
          { refusal: { code: "context.missing", detail: "anonymous" } },
          { status: 403 },
        ),
  );
  vi.stubGlobal("fetch", fetcher);
  sessionStorage.clear();
  try {
    const write = hostFetch("/pe/route-view/pumps", { method: "PUT", body: "{}" });
    admitted = true;
    await answerNavigation();
    expect((await write).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally {
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
