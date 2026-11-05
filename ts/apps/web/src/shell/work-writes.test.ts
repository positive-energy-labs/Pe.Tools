import { expect, test, vi } from "vite-plus/test";
import {
  bindWork,
  type WorkWrite,
  type WorkWriteAck,
  type RouteStateWriteResult,
} from "@pe/agent-contracts";
import { acquireWorkWriter } from "./work-writes";
import type { MountScope } from "./mount-owner";

test("a retired handle cannot remove the next owner of the same Work", () => {
  const key = bindWork("writer-lifetime", null, crypto.randomUUID());
  const old = acquireWorkWriter(key);
  old.release();
  const current = acquireWorkWriter(key);
  old.writer.discard("already gone");
  const next = acquireWorkWriter(key);
  try {
    expect(next.writer).toBe(current.writer);
  } finally {
    next.release();
    current.release();
  }
});

test("refused input survives release, shares conflict admission, and clears only on acknowledgement or discard", async () => {
  const key = bindWork("retained-head", null, crypto.randomUUID());
  const held = acquireWorkWriter(key);
  const scope: MountScope<{ cells: Record<string, unknown> }> = {
    target: { kind: "host" },
    workKey: key,
    work: { handle: { key, revision: 3 }, doc: { cells: {} } },
  };
  const request: WorkWrite = {
    kind: "apply",
    press: "head-take",
    expectedRevision: 3,
    patches: [{ path: ["cells", "a"], value: "mine" }],
  };
  const port = vi.fn(
    async (): Promise<RouteStateWriteResult> => ({
      ok: false,
      kind: "error",
      code: "stale_revision",
      error: "stale",
      hint: "reread",
    }),
  );
  expect((await held.writer.write(scope, request, port)).ok).toBe(false);
  expect(held.writer.conflict()).toBe(true);
  held.release();
  const next = acquireWorkWriter({ ...key });
  try {
    expect(next.writer.pending()).toEqual([request]);
    expect((await next.writer.write(scope, request, port)).ok).toBe(false);
    expect(port).toHaveBeenCalledTimes(1);
    const fresh = { ...scope, work: { ...scope.work!, handle: { key, revision: 4 } } };
    next.writer.observe(fresh);
    expect(next.writer.conflict()).toBe(false);
    const retry = { ...request, expectedRevision: 4 };
    const ack: WorkWriteAck = {
      ...retry,
      key,
      by: "human",
      base: 4,
      revision: 5,
      inverse: [{ path: ["cells", "a"] }],
      undoable: true,
    };
    expect(
      (await next.writer.write(fresh, retry, async () => ({ ok: true, revision: 5, handle: { key: ack.key, revision: 5 }, write: ack })))
        .ok,
    ).toBe(true);
    expect(next.writer.pending()).toEqual([]);
    expect(next.writer.journal.read().undo.map(({ press }) => press)).toEqual(["head-take"]);
    await next.writer.write({ ...fresh, closed: true }, { ...retry, press: "closed-edit" }, port);
    expect(next.writer.pending()[0]!.press).toBe("closed-edit");
    next.writer.discard("closed-edit");
    expect(next.writer.pending()).toEqual([]);
  } finally {
    next.release();
  }
});

test("closed, failed, unhydrated, foreign and domain-refused Work never reaches transport and keeps its input", async () => {
  const key = bindWork("admit-head", null, crypto.randomUUID());
  const held = acquireWorkWriter(key);
  const scope: MountScope<{ cells: Record<string, unknown> }> = {
    target: { kind: "host" },
    workKey: key,
    work: { handle: { key, revision: 0 }, doc: { cells: {} } },
  };
  const port = vi.fn();
  try {
    const blocked = [
      { ...scope, closed: true },
      { ...scope, failure: "unreadable" },
      { ...scope, work: null },
      { ...scope, workKey: bindWork(key.route, null, "foreign") },
    ];
    for (const [index, snapshot] of blocked.entries()) {
      const request: WorkWrite = {
        kind: "apply",
        press: `blocked-${index}`,
        expectedRevision: 0,
        patches: [{ path: ["cells", "a"], value: "mine" }],
      };
      expect((await held.writer.write(snapshot, request, port)).ok).toBe(false);
      expect(held.writer.pending()).toContainEqual(request);
      held.writer.discard(request.press!);
    }
    const request: WorkWrite = {
      kind: "apply",
      press: "domain",
      expectedRevision: 0,
      patches: [{ path: ["cells", "a"], value: "mine" }],
    };
    expect(
      await held.writer.write(scope, request, port, {
        cells: [
          {
            segment: "cells",
            groupOf: () => [],
            admit: () => ({ code: "not-ready", message: "domain rule" }),
          },
        ],
      }),
    ).toMatchObject({ ok: false, error: "domain rule" });
    expect(held.writer.pending()).toEqual([request]);
    held.writer.discard("domain");
    expect(port).not.toHaveBeenCalled();
  } finally {
    held.release();
  }
});

test("a transport failure retains the edit and an acknowledgement for another Work cannot enter the journal", async () => {
  const key = bindWork("failed-head", null, crypto.randomUUID());
  const held = acquireWorkWriter(key);
  const scope: MountScope<{}> = {
    target: { kind: "host" },
    workKey: key,
    work: { handle: { key, revision: 0 }, doc: {} },
  };
  const request: WorkWrite = {
    kind: "apply",
    press: "failed",
    expectedRevision: 0,
    patches: [{ path: ["note"], value: "retain" }],
  };
  try {
    expect(
      await held.writer.write(scope, request, async () => {
        throw Error("offline");
      }),
    ).toMatchObject({ ok: false, error: "offline" });
    expect(held.writer.pending()).toEqual([request]);
    const ack: WorkWriteAck = {
      ...request,
      key: bindWork(key.route, null, "foreign"),
      by: "human",
      base: 0,
      revision: 1,
      inverse: [],
      undoable: true,
    };
    expect(
      (await held.writer.write(scope, request, async () => ({ ok: true, revision: 1, handle: { key: ack.key, revision: 1 }, write: ack })))
        .ok,
    ).toBe(false);
    expect(held.writer.journal.read().undo).toEqual([]);
    expect(held.writer.pending()).toEqual([request]);
    held.writer.discard("failed");
  } finally {
    held.release();
  }
});

test("sequential human edits wait for the acknowledged revision of the same Work", async () => {
  const key = bindWork("queued-human", null, crypto.randomUUID());
  const held = acquireWorkWriter(key);
  const scope: MountScope<{}> = {
    target: { kind: "host" },
    workKey: key,
    work: { handle: { key, revision: 0 }, doc: {} },
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const port = vi.fn(async (_key, request: WorkWrite): Promise<RouteStateWriteResult> => {
    if (request.press === "first") await gate;
    return {
      ok: true,
      revision: request.expectedRevision + 1,
      handle: { key, revision: request.expectedRevision + 1 },
      write: {
        ...request,
        key,
        by: "human",
        base: request.expectedRevision,
        revision: request.expectedRevision + 1,
        inverse: [],
        undoable: true,
      },
    };
  });
  const edit = (press: string) =>
    held.writer.write(
      scope,
      {
        kind: "apply",
        press,
        expectedRevision: 0,
        patches: [{ path: [press], value: press }],
      },
      port,
      {},
      undefined,
      true,
    );
  const first = edit("first");
  const second = edit("second");
  await Promise.resolve();
  expect(port).toHaveBeenCalledTimes(1);
  release();
  expect((await first).ok).toBe(true);
  expect((await second).ok).toBe(true);
  expect(port.mock.calls.map(([, request]) => request.expectedRevision)).toEqual([0, 1]);
  // A query observed r0: it may not overwrite either acknowledged human edit.
  const query = { kind: "apply" as const, press: "query", expectedRevision: 0,
    patches: [{ path: ["query"], value: "old observation" }] };
  await held.writer.write(scope, query, port);
  expect(port.mock.calls.at(-1)![1].expectedRevision).toBe(0);
  // A foreign acknowledgement is not our sequential human intent.
  held.writer.accept({ ...query, key, by: "pea", base: 2, revision: 3, inverse: [], undoable: true });
  await edit("after-foreign");
  expect(port.mock.calls.at(-1)![1].expectedRevision).toBe(2);
  held.release();
});
