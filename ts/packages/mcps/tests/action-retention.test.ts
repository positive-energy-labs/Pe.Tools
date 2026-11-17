import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  actionReceiptSchema,
  canonicalRouteInput,
  type ActionAdmission,
  type ActionReceipt,
} from "@pe/agent-contracts";
import { bodyText } from "./body-text.ts";

const target = { session: "S", openId: "open-1" };
const receipt = (
  admission: Pick<ActionReceipt, "id" | "key" | "target" | "input">,
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
const client = () => import("@pe/mcps/actions");
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
    posted: ActionAdmission[] = [],
    resent: (string | null)[] = [];
  let lose = true;
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json([]);
    const body = JSON.parse(await bodyText(init));
    posted.push(body);
    resent.push(new Headers(init.headers).get("x-pe-admission-resend"));
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
  const sentAt = api.inspectRetainedActions().find(record => record.id === first.id)?.sentAt;
  expect(sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
  // A retry keeps the first send time across reload, so the host can compare it with its discard.
  expect(resent[0]).toBeNull();
  expect(resent[1]).toBe(sentAt);
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
  expect(api.inspectRetainedActions()).toContainEqual({ id: admission.id, admission, sentAt: expect.any(String) });
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

test.each(["same","target","input"] as const)("INT-RECEIPT observer compares %s retained identity without live input reinterpretation",async(change)=>{
  const api=await client(),release=vi.fn();
  const original=actionReceiptSchema.parse({...receipt({id:crypto.randomUUID(),key:"pod.export",target:{kind:"host"},input:{}},"running"),
    key:"families.apply",input:{originalWorkKey:"families/open:private-original/original-open"},
    target:{kind:"unavailable-original",original:{kind:"document",ref:{session:"private-original",openId:"original-open"}}}});
  const next=actionReceiptSchema.parse({...original,state:"succeeded",result:{original:true},
    ...(change==="target"?{target:{kind:"unavailable-original",original:{kind:"document",ref:{session:"other-original",openId:"original-open"}}}}:{}),
    ...(change==="input"?{input:{originalWorkKey:"changed"}}:{}),
  });
  const unbind=api.bindActionObserver((_id,_base,accept)=>{accept(next);return release;});
  try{
    const waiting=api.waitForAction(original.id,base(),1000,undefined,original);
    if(change==="same") expect(await waiting).toEqual(next);
    else await expect(waiting).rejects.toThrow("different intent or target");
    expect(release).toHaveBeenCalledOnce();
  }finally{unbind();}
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
  expect(retained).toEqual({ id, admission: firstPosts[0], sentAt: expect.any(String) });
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

// D35: a `pea script` run with --timeout-seconds 300 died at 79 s on a receipt poll slice.
test("a receipt poll that outlives its slice is asked again, so the run's own timeout is the only budget", async () => {
  const endpoint = base();
  const admission: ActionAdmission = {
    id: crypto.randomUUID(),
    key: "pod.export",
    target: { kind: "host" },
    input: { pod: "a", archivePath: "a.zip" },
  };
  // Poll slices run 1000x fast: the 26 s slice ends at 26 ms, and the host answers after it.
  const real = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => real(ms / 1000));
  let polls = 0;
  vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) =>
    ++polls === 1
      ? new Promise((_, reject) =>
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason)),
        )
      : Promise.resolve(Response.json([receipt(admission)])),
  );
  try {
    const api = await client();
    expect(
      await api.waitForAction(admission.id, endpoint, 300_000, undefined, receipt(admission, "running")),
    ).toMatchObject({ state: "succeeded", result: { done: true } });
    expect(polls).toBe(2);
    expect(
      new api.ActionResultError({ state: "detached", id: "a1", key: "scripting.execute", acceptance: "admitted" }).message,
    ).toContain("action.read");
  } finally {
    vi.restoreAllMocks();
  }
});


test.each(["succeeded", "running"] as const)(
  "explicit-ID reconnect reads %s historical input without fresh admission or POST",
  async (state) => {
    const api = await client(), endpoint = base();
    const original = receipt({
      id: crypto.randomUUID(), key: "families.apply",
      input: { originalWorkKey: "families/open:private-original/original-open" },
      target: { kind: "unavailable-original", original: { kind: "document", ref: target } },
    }, state);
    const requests = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).not.toBe("POST");
      return Response.json([original]);
    });
    vi.stubGlobal("fetch", requests);
    const result = await api.recoverAction(original.id, original.key, original.input, undefined, endpoint, 0);
    expect(result).toEqual(state === "running"
      ? { state: "detached", id: original.id, key: original.key, acceptance: "admitted" }
      : original);
    expect(requests).toHaveBeenCalledOnce();
  },
);

test.each(["id", "key", "input", "target"] as const)(
  "explicit-ID historical reconnect refuses mismatched %s without POST",
  async (change) => {
    const api = await client(), endpoint = base();
    const original = receipt({
      id: crypto.randomUUID(), key: "families.apply",
      input: { originalWorkKey: "families/open:private-original/original-open" },
      target: { kind: "unavailable-original", original: { kind: "document", ref: target } },
    });
    const requests = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).not.toBe("POST");
      return Response.json([original]);
    });
    vi.stubGlobal("fetch", requests);
    await expect(api.recoverAction(
      change === "id" ? "another-id" : original.id,
      change === "key" ? "families.plan" : original.key,
      change === "input" ? { ...original.input, changed: true } : original.input,
      change === "target" ? { kind: "document", ref: target } : undefined,
      endpoint, 100,
    )).rejects.toThrow(change === "id" ? "different receipt id" : "different intent or target");
    expect(requests).toHaveBeenCalledOnce();
  },
);

test("fresh admission still rejects historical command input before any POST", async () => {
  const api = await client(), requests = vi.fn();
  vi.stubGlobal("fetch", requests);
  await expect(api.submitAction({
    id: crypto.randomUUID(), key: "families.apply",
    target: { kind: "document", ref: target },
    input: { originalWorkKey: "families/open:private-original/original-open" },
  }, base(), 100)).rejects.toThrow();
  expect(requests).not.toHaveBeenCalled();
});
