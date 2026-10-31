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
      (await next.writer.write(fresh, retry, async () => ({ ok: true, revision: 5, write: ack })))
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
      await held.writer.write(scope, request, port, [
        {
          segment: "cells",
          groupOf: () => [],
          admit: () => ({ code: "not-ready", message: "domain rule" }),
        },
      ]),
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
      (await held.writer.write(scope, request, async () => ({ ok: true, revision: 1, write: ack })))
        .ok,
    ).toBe(false);
    expect(held.writer.journal.read().undo).toEqual([]);
    expect(held.writer.pending()).toEqual([request]);
    held.writer.discard("failed");
  } finally {
    held.release();
  }
});
