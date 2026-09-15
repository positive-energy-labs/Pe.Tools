import { expect, test, vi } from "vite-plus/test";
import { TurnDocuments } from "../src/pea/owned-documents.ts";
import { ownedTurnDocuments, peDo, peRead } from "../src/pea/capability-tools.ts";
import { buildCapabilities } from "../src/pea/capabilities.ts";
import { turnContextKey } from "@pe/agent-contracts";

test("cancel before late acquisition releases the admitted ID without a duplicate open", async () => {
  const owner = new TurnDocuments();
  let complete!: (value: unknown) => void;
  const open = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const release = vi.fn(async () => ({ status: "released" }));
  const pending = owner.acquire("turn", "id", open, release);
  await owner.finish("turn");
  complete({ status: "acquired" });
  await pending;
  expect(open).toHaveBeenCalledTimes(1);
  expect(release).toHaveBeenCalled();
  await owner.acquire("turn", "id", open, release);
  expect(open).toHaveBeenCalledTimes(1);
});

test("failed acquisition still releases by original identity and exposes refusal", async () => {
  const owner = new TurnDocuments();
  const release = vi.fn(async () => ({ status: "recovery-required", detail: "modified" }));
  await expect(
    owner.acquire(
      "turn",
      "id",
      async () => {
        throw new Error("lost reply");
      },
      release,
    ),
  ).rejects.toThrow("lost reply");
  expect(await owner.finish("turn")).toEqual([
    { acquisitionId: "id", result: { status: "recovery-required", detail: "modified" } },
  ]);
});

test("a thrown release is durably reported and finishOwner returns its outcome", async () => {
  const owner = new TurnDocuments();
  const durable = new Map<string, unknown>();
  owner.bind("turn", "session", async (receipt) => {
    durable.set(receipt.acquisitionId, structuredClone(receipt));
  });
  await owner.acquire(
    "turn",
    "id",
    async () => ({ status: "acquired" }),
    async () => {
      throw new Error("bridge gone");
    },
  );
  const cleanup = await owner.finishOwner("session");
  expect(cleanup).toEqual([
    { acquisitionId: "id", result: { status: "recovery-required", detail: "Error: bridge gone" } },
  ]);
  expect(durable.get("id")).toEqual(cleanup[0]);
});

test("terminal cleanup ends a call awaiting its target, while a queued next turn remains usable", async () => {
  const owner = new TurnDocuments();
  owner.bind("running", "session", async () => {});
  owner.bind("queued", "session", async () => {});
  owner.startCall("running");
  await owner.finishOwner("session");
  const release = async () => ({ status: "released" });
  await expect(owner.acquire("running", "late", async () => "F", release)).rejects.toThrow(
    "Turn ended",
  );
  await expect(owner.acquire("queued", "next", async () => "F2", release)).resolves.toBe("F2");
  await owner.finishOwner("session", true);
});

test("late cleanup and reporting failure cannot replace the original open failure", async () => {
  const owner = new TurnDocuments();
  let fail!: (error: Error) => void;
  let rejectReports = false;
  owner.bind("turn", "session", async () => {
    if (rejectReports) throw new Error("storage gone");
  });
  const pending = owner.acquire(
    "turn",
    "id",
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
    async () => {
      throw new Error("release gone");
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  rejectReports = true;
  await owner.finishOwner("session");
  fail(new Error("original tool failure"));
  await expect(pending).rejects.toThrow("original tool failure");
  expect((await owner.finish("turn"))[0]).toMatchObject({
    reportingError: "Error: storage gone",
    result: { detail: "Error: release gone" },
  });
});

test("admission is durable before open and a reused identity cannot switch sources", async () => {
  const owner = new TurnDocuments();
  const writes: unknown[] = [];
  owner.bind("turn", "session", async (receipt) => {
    writes.push(receipt);
  });
  const open = vi.fn(async () => {
    expect(writes).toHaveLength(1);
    return { status: "borrowed" };
  });
  const release = async () => ({ status: "borrowed" });
  await owner.acquire("turn", "id", open, release, "A:F");
  await expect(owner.acquire("turn", "id", open, release, "B:F")).rejects.toThrow(
    "different source",
  );
  expect(open).toHaveBeenCalledTimes(1);
});

test("a failed query releases current and late attempts but permits a new acquisition in the same turn", async () => {
  const owner = new TurnDocuments();
  let complete!: (value: unknown) => void;
  const release = vi.fn(async () => ({ status: "released" }));
  const old = owner.acquire(
    "turn",
    "old",
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
    release,
  );
  await owner.releaseCurrent("turn");
  const nextRelease = vi.fn(async () => ({ status: "released" }));
  await expect(owner.acquire("turn", "new", async () => "F2", nextRelease)).resolves.toBe("F2");
  complete("F1");
  await old;
  expect(release).toHaveBeenCalledTimes(2);
  expect(nextRelease).not.toHaveBeenCalled();
  await owner.finish("turn");
  expect(nextRelease).toHaveBeenCalledOnce();
  await expect(owner.acquire("turn", "after-end", async () => "F3", nextRelease)).rejects.toThrow(
    "Turn ended",
  );
});

test("real doors acquire F from A, preserve failed query, permit F2, and retain frozen A", async () => {
  vi.stubEnv("PE_TOOLS_HOST_BASE_URL", "http://127.0.0.1:92");
  const turn = {
    id: crypto.randomUUID(),
    thread: "owned-proof",
    revision: 7,
    defaultTarget: { kind: "open", ref: { session: "bridge", openId: "A" } },
  };
  const before = structuredClone(turn);
  const events: Array<[string, string | null]> = [];
  const reports: unknown[] = [];
  ownedTurnDocuments.bind(turn.id, turn.id, async (receipt) => {
    reports.push(receipt);
  });
  const operations = [
    {
      key: "family.temporary.acquire",
      needs: "project-document" as const,
      intent: "Mutate" as const,
    },
    { key: "family.inspect", needs: "family-document" as const, intent: "Read" as const },
    { key: "project.inspect", needs: "project-document" as const, intent: "Read" as const },
  ];
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === "/pe/capabilities")
      return Response.json({
        at: new Date().toISOString(),
        sessions: [],
        sources: { catalog: "ok" },
        capabilities: buildCapabilities({ ops: operations, routes: [], pods: null, skills: [] }),
      });
    if (url.pathname === "/ops") return Response.json({ operations });
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (body.key === "bridge.sessions.list")
      return Response.json({
        sessions: [
          {
            sessionId: "bridge",
            connected: true,
            openDocuments: [
              { openId: "A", address: "C:\\Models\\A.rvt", isFamilyDocument: false },
              { openId: "F", address: null, isFamilyDocument: true },
            ],
          },
        ],
      });
    if (url.pathname === "/actions") {
      expect(body.id).toEqual(expect.any(String));
      expect(body.actor).toBe("agent");
      events.push([
        body.key,
        body.destination.kind === "document" ? body.destination.ref.openId : null,
      ]);
      const result =
        body.key === "family.temporary.acquire"
          ? {
              acquisitionId: body.input.acquisitionId,
              status: "acquired",
              document: { session: "bridge", openId: "F" },
            }
          : { status: "released" };
      const { input: request, ...intent } = body;
      return Response.json({
        ...intent,
        request,
        steps: [],
        preparation: { state: "ready", value: {} },
        recovery: [],
        publication: { state: "unrequested" },
        startedAt: "now",
        state: "succeeded",
        result,
      });
    }
    const headers = new Headers(init?.headers);
    events.push([body.key, headers.get("x-pe-open-document-id")]);
    if (body.key === "family.inspect")
      return Response.json({ message: "original query failure" }, { status: 500 });
    if (body.key === "document.temporary.release") return Response.json({ status: "released" });
    if (body.key === "family.temporary.acquire")
      return Response.json({
        acquisitionId: body.request.acquisitionId,
        status: "acquired",
        document: { session: "bridge", openId: "F" },
      });
    return Response.json({ done: true });
  });
  const context = { requestContext: { [turnContextKey]: turn } };
  try {
    const acquire = () =>
      peDo.execute!(
        {
          key: "op:family.temporary.acquire",
          input: { acquisitionId: crypto.randomUUID(), familyId: 42 },
          timeoutSeconds: 30,
        } as never,
        context as never,
      );
    // pe_do returns the action envelope: the original receipt beside the response it produced.
    // Assert the receipt itself, not a shape with the envelope matched away.
    const first = (await acquire()) as {
      ok: boolean;
      result: {
        ok: boolean;
        key: string;
        response: unknown;
        action: {
          id: string;
          key: string;
          kind: string;
          actor: string;
          state: string;
          destination: unknown;
          request: unknown;
          result: unknown;
        };
      };
    };
    expect(first.ok).toBe(true);
    expect(first.result.ok).toBe(true);
    expect(first.result.key).toBe("family.temporary.acquire");
    const receipt = first.result.action;
    // An original receipt ID exists and is the operation's own.
    expect(receipt.id).toEqual(expect.any(String));
    expect(receipt.id.length).toBeGreaterThan(0);
    expect(receipt.key).toBe("family.temporary.acquire");
    expect(receipt.kind).toBe("operation");
    expect(receipt.actor).toBe("agent");
    expect(receipt.state).toBe("succeeded");
    // The exact per-call destination is the document the call was made against (A) — never the
    // temporary document the call went on to acquire (F).
    expect(receipt.destination).toEqual({
      kind: "document",
      ref: { session: "bridge", openId: "A" },
    });
    // The receipt's own result and the returned response are the same acquisition.
    expect(receipt.result).toMatchObject({
      status: "acquired",
      document: { session: "bridge", openId: "F" },
    });
    expect(first.result.response).toEqual(receipt.result);
    expect(
      await peRead.execute!(
        {
          key: "op:family.inspect",
          target: { kind: "open", ref: { session: "bridge", openId: "F" } },
          timeoutSeconds: 30,
        } as never,
        context as never,
      ),
    ).toMatchObject({
      ok: false,
      result: { message: expect.stringContaining("original query failure") },
      cleanup: [{ result: { status: "released" } }],
    });
    // The retry after the failed query is a new original operation, not a replay of the first ID.
    const second = (await acquire()) as { ok: boolean; result: { action: { id: string } } };
    expect(second.ok).toBe(true);
    expect(second.result.action.id).not.toBe(receipt.id);
    expect(
      await peRead.execute!(
        { key: "op:project.inspect", timeoutSeconds: 30 } as never,
        context as never,
      ),
    ).toMatchObject({ ok: true });
    await ownedTurnDocuments.finishOwner(turn.id);
    expect(events).toEqual([
      ["family.temporary.acquire", "A"],
      ["family.inspect", "F"],
      ["document.temporary.release", null],
      ["family.temporary.acquire", "A"],
      ["project.inspect", "A"],
      ["document.temporary.release", null],
    ]);
    expect(reports).toHaveLength(4);
    expect(turn).toEqual(before);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
