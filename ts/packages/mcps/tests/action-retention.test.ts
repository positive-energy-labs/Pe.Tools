import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  actionReceiptSchema,
  canonicalRouteInput,
  type ActionAdmission,
} from "@pe/agent-contracts";
import { bodyText } from "./body-text.ts";

const target = { session: "S", openId: "open-1" };
const receipt = (
  admission: ActionAdmission,
  state: "running" | "succeeded" | "cancelled" = "succeeded",
) =>
  actionReceiptSchema.parse({
    ...admission,
    caller: { kind: "human", via: "local" },
    basis: { kind: "human" },
    steps: [],
    prepared: { state: "unprepared" },
    recovery: [],
    startedAt: "2026-10-27T00:00:00Z",
    state,
    ...(state === "succeeded"
      ? { result: { done: true } }
      : state === "cancelled"
        ? { error: "stopped", status: 499 }
        : {}),
  });
const base = () => `http://${crypto.randomUUID()}.test`;
const client = () => import("../src/shared/takeoff-action-client.ts");
afterEach(() => vi.unstubAllGlobals());

function host(
  rows: Map<string, ReturnType<typeof receipt>>,
  state: "running" | "succeeded" = "running",
) {
  const posts: ActionAdmission[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (init?.method === "POST") {
      const body = JSON.parse(await bodyText(init));
      if (url.pathname === "/actions/cancel") {
        const row = receipt(rows.get(body.id)!, "cancelled");
        rows.set(body.id, row);
        return Response.json(row);
      }
      posts.push(body);
      const row = receipt(body, state);
      rows.set(body.id, row);
      return Response.json(row);
    }
    const row = rows.get(url.searchParams.get("id")!);
    return Response.json(row ? [row] : []);
  });
  return posts;
}

test("a settled retained attempt is history; a new press receives a new id", async () => {
  const rows = new Map<string, ReturnType<typeof receipt>>();
  const posts = host(rows);
  const api = await client(),
    endpoint = base();
  const first = await api.runSemanticAction(
    "families.plan",
    { familyNames: ["a"] },
    target,
    undefined,
    endpoint,
    undefined,
    0,
  );
  expect(first.state).toBe("detached");
  rows.set(first.id, receipt(rows.get(first.id)!, "cancelled"));
  const second = await api.runSemanticAction(
    "families.plan",
    { familyNames: ["b"] },
    target,
    undefined,
    endpoint,
    undefined,
    0,
  );
  expect(second.id).not.toBe(first.id);
  expect(posts).toHaveLength(2);
});

test("a running attempt is reattached without submitting newer intent and the stop control reaches its journal", async () => {
  const rows = new Map<string, ReturnType<typeof receipt>>();
  const posts = host(rows);
  const api = await client(),
    endpoint = base();
  const first = await api.runSemanticAction(
    "families.plan",
    { familyNames: ["a"] },
    target,
    undefined,
    endpoint,
    undefined,
    0,
  );
  const again = await api.runSemanticAction(
    "families.plan",
    { familyNames: ["b"] },
    target,
    undefined,
    endpoint,
    undefined,
    0,
  );
  expect(again).toEqual(first);
  expect(posts).toHaveLength(1);
  expect((await api.cancelAction(first.id, endpoint)).state).toBe("cancelled");
  expect(api.runningAdmissions()).toEqual([]);
});

test("pre-admission loss survives a client reload and resends exact bytes despite newer Work", async () => {
  const endpoint = base(),
    posted: ActionAdmission[] = [];
  let lose = true;
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json([]);
    const body = JSON.parse(await bodyText(init));
    posted.push(body);
    if (lose) throw Error("connection lost before admission");
    return Response.json(receipt(body));
  });
  let api = await client();
  const work = {
    key: { binding: "workspace" as const, route: "families", target: null, work: "draft" },
    revision: 13,
  };
  const first = await api.runSemanticAction(
    "families.plan",
    { familyNames: ["a"] },
    target,
    work,
    endpoint,
    undefined,
    0,
  );
  expect(first).toMatchObject({ state: "detached", acceptance: "unknown" });
  vi.resetModules();
  api = await client();
  lose = false;
  const retry = await api.runSemanticAction(
    "families.plan",
    { familyNames: ["b"] },
    target,
    { ...work, revision: 14 },
    endpoint,
    undefined,
    100,
  );
  expect(retry).toMatchObject({ id: first.id, state: "succeeded" });
  expect(posted).toEqual([posted[0], posted[0]]);
  expect(posted[1]!.input.work).toEqual(work);
});

test("lost admission ACK recovers the durable row without a second POST", async () => {
  const endpoint = base(),
    posted: ActionAdmission[] = [];
  let row: ReturnType<typeof receipt> | undefined;
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json(row ? [row] : []);
    const body = JSON.parse(await bodyText(init));
    posted.push(body);
    row = receipt(body);
    throw Error("ACK lost after admission");
  });
  const result = await (
    await client()
  ).runSemanticAction("families.plan", {}, target, undefined, endpoint, undefined, 100);
  expect(result.state).toBe("succeeded");
  expect(posted).toHaveLength(1);
});

test("ACK drops retained bytes; reload uses id and existing GET wait without a POST", async () => {
  const endpoint = base(),
    rows = new Map<string, ReturnType<typeof receipt>>();
  host(rows);
  let api = await client();
  const admission: ActionAdmission = {
    id: crypto.randomUUID(),
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "a", archivePath: "a.zip" },
  };
  expect(await api.submitAction(admission, endpoint, 0)).toMatchObject({
    state: "detached",
    acceptance: "admitted",
  });
  expect(api.inspectRetainedActions()).toContainEqual({ id: admission.id });
  vi.resetModules();
  api = await client();
  const reads: URL[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.method).not.toBe("POST");
    const url = new URL(input instanceof Request ? input.url : String(input));
    reads.push(url);
    return Response.json([
      receipt(admission, url.searchParams.has("wait") ? "succeeded" : "running"),
    ]);
  });
  expect(
    await api.recoverAction(admission.id, admission.key, admission.input, undefined, endpoint, 100),
  ).toMatchObject({ state: "succeeded" });
  expect(reads.map((url) => url.pathname)).toEqual(["/actions", "/actions"]);
  expect(reads[1]!.searchParams.has("wait")).toBe(true);
});

test("an acknowledged id missing from GET is retained and cannot be reconstructed or reposted", async () => {
  const endpoint = base(),
    rows = new Map<string, ReturnType<typeof receipt>>();
  const posts = host(rows);
  const api = await client();
  const admission: ActionAdmission = {
    id: crypto.randomUUID(),
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "a", archivePath: "a.zip" },
  };
  await api.submitAction(admission, endpoint, 0);
  rows.clear();
  await expect(
    api.recoverAction(admission.id, admission.key, admission.input, undefined, endpoint, 100),
  ).rejects.toThrow("Acknowledged action");
  expect(posts).toHaveLength(1);
  expect(api.inspectRetainedActions()).toContainEqual({ id: admission.id });
});

test("a schema-valid ACK for another target is rejected and preserves pre-ACK intent", async () => {
  const endpoint = base(),
    api = await client();
  const admission: ActionAdmission = {
    id: crypto.randomUUID(),
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "a", archivePath: "a.zip" },
  };
  vi.stubGlobal("fetch", async () =>
    Response.json(receipt({ ...admission, target: { kind: "document", ref: target } })),
  );
  await expect(api.submitAction(admission, endpoint, 100)).rejects.toThrow(
    "different intent or target",
  );
  expect(api.inspectRetainedActions()).toContainEqual({ id: admission.id, admission });
});

test("browser completion follows the existing receipt observer without a GET and releases synchronous snapshots", async () => {
  const endpoint = base(),
    api = await client(),
    release = vi.fn();
  const admission: ActionAdmission = {
    id: crypto.randomUUID(),
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "a", archivePath: "a.zip" },
  };
  const posted: ActionAdmission[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    expect(init?.method).toBe("POST");
    const body = JSON.parse(await bodyText(init));
    posted.push(body);
    return Response.json(receipt(body, "running"));
  });
  const unbind = api.bindActionObserver((id, base, accept) => {
    expect([id, base]).toEqual([admission.id, endpoint]);
    accept(receipt(admission));
    return release;
  });
  try {
    expect(await api.submitAction(admission, endpoint, 100)).toMatchObject({ state: "succeeded" });
    expect(posted).toEqual([admission]);
    expect(release).toHaveBeenCalledOnce();
  } finally {
    unbind();
  }
});

test("browser completion detaches at its bounded deadline and releases its receipt subscription", async () => {
  const endpoint = base(),
    rows = new Map<string, ReturnType<typeof receipt>>();
  host(rows);
  const api = await client(),
    release = vi.fn();
  const admission: ActionAdmission = {
    id: crypto.randomUUID(),
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "a", archivePath: "a.zip" },
  };
  const unbind = api.bindActionObserver(() => release);
  try {
    expect(
      await api.waitForAction(admission.id, endpoint, 10, undefined, receipt(admission, "running")),
    ).toMatchObject({
      state: "detached",
      acceptance: "admitted",
    });
    expect(release).toHaveBeenCalledOnce();
    expect(api.runningAdmissions()).toEqual([]);
  } finally {
    unbind();
  }
});

test("a fresh receipt observer cannot substitute another admitted target", async () => {
  const endpoint = base(),
    rows = new Map<string, ReturnType<typeof receipt>>();
  host(rows);
  const api = await client(),
    release = vi.fn();
  const admission: ActionAdmission = {
    id: crypto.randomUUID(),
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "a", archivePath: "a.zip" },
  };
  const unbind = api.bindActionObserver((_id, _base, accept) => {
    accept(receipt({ ...admission, target: { kind: "document", ref: target } }));
    return release;
  });
  try {
    await expect(api.submitAction(admission, endpoint, 100)).rejects.toThrow(
      "different intent or target",
    );
    expect(release).toHaveBeenCalledOnce();
  } finally {
    unbind();
  }
});

test("an authoritative no-dispatch refusal releases the slot for a new explicit press", async () => {
  const endpoint = base(),
    posted: ActionAdmission[] = [];
  let refuse = true;
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json([]);
    const body = JSON.parse(await bodyText(init));
    posted.push(body);
    return refuse
      ? Response.json(
          {
            error: {
              code: "grant.revoked",
              message: "Grant revoked",
              details: { notDispatched: true },
            },
          },
          { status: 403 },
        )
      : Response.json(receipt(body));
  });
  const api = await client();
  await expect(
    api.runSemanticAction(
      "families.plan",
      { familyNames: ["a"] },
      target,
      undefined,
      endpoint,
      undefined,
      100,
    ),
  ).rejects.toThrow("Grant revoked");
  refuse = false;
  expect(
    await api.runSemanticAction(
      "families.plan",
      { familyNames: ["b"] },
      target,
      undefined,
      endpoint,
      undefined,
      100,
    ),
  ).toMatchObject({ state: "succeeded" });
  expect(posted).toHaveLength(2);
  expect(posted[1]!.id).not.toBe(posted[0]!.id);
  expect(posted[1]!.input.familyNames).toEqual(["b"]);
});

test("a later root cannot rebuild a lost pre-ACK id or borrow authority; the original root retries exact bytes", async () => {
  const endpoint = base(),
    id = crypto.randomUUID(),
    slot = `pe-action:${endpoint}:${id}:${canonicalRouteInput(null)}`;
  const api = await client();
  const { withInvocationContext, readOutbox } = await import("@pe/runtime/context");
  const { runCapability } = await import("../src/shared/admission.ts");
  const work = {
    key: { binding: "workspace" as const, route: "schedules", target: null, work: "reviewed" },
    revision: 13,
  };
  const input = { work };
  const contextA = { hostBaseUrl: endpoint, headers: { "x-pe-context": "root-A" } };
  const contextB = { hostBaseUrl: endpoint, headers: { "x-pe-context": "root-B" } };
  const select = vi.fn(async () => ({
    bridgeSessionId: target.session,
    openDocumentId: target.openId,
  }));
  const firstPosts: ActionAdmission[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json([]);
    firstPosts.push(JSON.parse(await bodyText(init)));
    throw Error("POST lost before host admission");
  });
  expect(
    await withInvocationContext(contextA, () =>
      runCapability("schedule.grid.push", input, {
        hostBaseUrl: endpoint,
        actionId: id,
        timeoutMs: 0,
        receipt: true,
        resolveTarget: select,
      }),
    ),
  ).toMatchObject({ id, state: "detached", acceptance: "unknown" });
  const retained = withInvocationContext(contextA, () => readOutbox(slot));
  expect(retained).toEqual({ id, admission: firstPosts[0] });
  select.mockClear();
  const network = vi.fn(async () => Response.json([]));
  vi.stubGlobal("fetch", network);
  await expect(
    withInvocationContext(contextB, () =>
      runCapability(
        "schedule.grid.push",
        { work: { ...work, revision: 14 } },
        {
          hostBaseUrl: endpoint,
          actionId: id,
          timeoutMs: 100,
          receipt: true,
          resolveTarget: select,
        },
      ),
    ),
  ).rejects.toThrow("captured caller context");
  expect(network).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(withInvocationContext(contextA, () => readOutbox(slot))).toEqual(retained);
  const retried: ActionAdmission[] = [];
  vi.stubGlobal("fetch", async (address: unknown, init?: RequestInit) => {
    expect(new URL(String(address)).pathname).toBe("/actions");
    if (init?.method !== "POST") return Response.json([]);
    const body = JSON.parse(await bodyText(init));
    retried.push(body);
    return Response.json(receipt(body));
  });
  expect(
    await withInvocationContext(contextA, () =>
      runCapability("schedule.grid.push", input, {
        hostBaseUrl: endpoint,
        actionId: id,
        timeoutMs: 100,
        receipt: true,
        resolveTarget: select,
      }),
    ),
  ).toMatchObject({ id, state: "succeeded" });
  expect(retried).toEqual(firstPosts);
  expect(select).not.toHaveBeenCalled();
  expect(api.runningAdmissions()).toEqual([]);
});
