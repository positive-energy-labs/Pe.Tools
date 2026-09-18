/**
 * w8-revit trip 10: a 52-family plan read `signal timed out` at 30 s while the host finished it.
 * The admission POST answers only once the host has prepared the action behind the Revit queue;
 * the client aborted it at 30 s and threw. Time here is scaled 1000:1 so 30 s is 30 ms.
 */
import { afterEach, expect, test, vi } from "vite-plus/test";
import { runSemanticAction } from "../src/shared/takeoff-action-client.ts";

const target = { session: "S", openId: "open-1" };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("an admission slower than the read signal is waited for and lands as it would have", async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => timeout(Math.ceil(ms / 1000)));
  const rows = new Map<string, Record<string, unknown>>();
  const row = (id: string, state: string, request: unknown) => ({
    id,
    kind: "workflow",
    key: "families.plan",
    actor: "human",
    destination: { kind: "document", ref: target },
    request,
    bases: {},
    steps: [],
    preparation: { state: "unprepared" },
    recovery: [],
    publication: { state: "unrequested" },
    startedAt: "2026-09-17T00:00:00.000Z",
    state,
    ...(state === "succeeded" ? { result: { plan: 52 } } : {}),
  });
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const body = JSON.parse(init.body as string) as { id: string; input: unknown };
      // The host prepares for "60 s", journals the row running, and settles it "30 s" later.
      return new Promise<Response>((resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        setTimeout(() => {
          rows.set(body.id, row(body.id, "running", body.input));
          setTimeout(() => rows.set(body.id, row(body.id, "succeeded", body.input)), 30);
          resolve(Response.json(rows.get(body.id), { status: 202 }));
        }, 60);
      });
    }
    const id = new URL(url, "http://host").searchParams.get("id")!;
    return Promise.resolve(Response.json(rows.has(id) ? [rows.get(id)] : []));
  });

  const settled = await runSemanticAction("families.plan", { scope: "ducts" }, target);
  expect(settled.state).toBe("succeeded");
  expect((settled as { result: unknown }).result).toEqual({ plan: 52 });
});
