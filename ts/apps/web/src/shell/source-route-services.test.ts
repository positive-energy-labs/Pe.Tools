import { expect, test, vi } from "vite-plus/test";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import * as host from "../host/runtime";
import { dataTablesSources } from "../data-tables/sources";
import { sourceRouteServices } from "./source-route-services";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { ReadingDelivery } from "./readings";
import type { ResolvedRead } from "../../../../packages/agent-contracts/src/route-kernel-environment";

test("Data Tables transports the captured document despite a different current selection", async () => {
  const target = {
    kind: "document" as const,
    ref: { session: "u8x-session", openId: "u8x-document" },
  };
  const transport = vi
    .spyOn(host, "hostFetch")
    .mockResolvedValue(new Response(JSON.stringify({ tables: [] })));
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(issuer.scope({ target, work: null }), "tables", 1);
  if (!attempt.ok) throw Error(attempt.reason);
  const token = attempt.value;
  const services = sourceRouteServices(dataTablesSources(), { target: () => ({ kind: "host" }) });
  // Adapter reproducer only. The mount test exercises issued descriptors.
  const request = {
    key: { op: "data-tables.tables", sortedKeyInput: "{}", freshnessGeneration: 1 },
  } as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, token);
  const release = services.readings.subscribe(request, token, vi.fn());
  try {
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    expect(transport).toHaveBeenCalledWith(
      "/call",
      expect.objectContaining({
        headers: expect.objectContaining({
          [HOST_RPC_BRIDGE_SESSION_HEADER]: target.ref.session,
          [HOST_RPC_DOCUMENT_HEADER]: target.ref.openId,
        }),
      }),
    );
  } finally {
    release();
    read.release();
    transport.mockRestore();
  }
});

test("catalog query uses the captured target and admitted arguments without a route adapter", async () => {
  const target = {
    kind: "document" as const,
    ref: { session: "catalog-session", openId: "catalog-document" },
  };
  const transport = vi.spyOn(host, "hostFetch").mockResolvedValue(new Response(JSON.stringify({})));
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(issuer.scope({ target, work: null }), "status", 1);
  if (!attempt.ok) throw Error(attempt.reason);
  const services = sourceRouteServices({});
  const request = {
    key: {
      op: "revit.detail.space-status",
      sortedKeyInput: '{"captureId":"scene-1"}',
      freshnessGeneration: 1,
    },
  } as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, attempt.value);
  const release = services.readings.subscribe(request, attempt.value, vi.fn());
  try {
    await vi.waitFor(() => expect(transport).toHaveBeenCalledOnce());
    const [path, options] = transport.mock.calls[0]!;
    expect(path).toBe("/call");
    expect(JSON.parse(options!.body as string)).toEqual({
      key: "revit.detail.space-status",
      request: { captureId: "scene-1" },
    });
    expect(options!.headers).toMatchObject({
      [HOST_RPC_BRIDGE_SESSION_HEADER]: target.ref.session,
      [HOST_RPC_DOCUMENT_HEADER]: target.ref.openId,
    });
  } finally {
    release();
    read.release();
    transport.mockRestore();
  }
});

test("ordinary sources receive admitted args and an empty Page; stale completions stay stale", async () => {
  const open = vi.fn((ctx, deliver) => {
    expect(ctx.page).toEqual({});
    expect(ctx.args).toEqual({ scene: "saved" });
    deliver({ kind: "complete", value: 1, revision: 1, fresh: false });
  });
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(
    issuer.scope({ target: { kind: "host" }, work: null }),
    "saved",
    1,
  );
  if (!attempt.ok) throw Error(attempt.reason);
  const services = sourceRouteServices({ saved: { kind: "use", open } });
  const request = {
    key: { op: "saved", sortedKeyInput: '{"scene":"saved"}', freshnessGeneration: 1 },
  } as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, attempt.value);
  const deliver = vi.fn();
  const release = services.readings.subscribe(request, attempt.value, deliver);
  expect(deliver).toHaveBeenCalledWith(
    expect.objectContaining({ status: "unavailable", current: false, reason: "Reading is stale" }),
  );
  release();
  read.release();
});

import { commands, actionReceiptSchema } from "@pe/agent-contracts";
import * as actions from "../../../../packages/mcps/src/shared/takeoff-action-client";
const previewTarget = {
  kind: "document" as const,
  ref: { session: "preview-session", openId: "preview-document" },
};
const previewInput = {
  work: {
    key: { route: "data-tables", binding: "open" as const, target: null, open: previewTarget.ref },
    revision: 7,
  },
};
const previewResult = (derivedRequest: unknown) => ({
  previewOnly: true,
  derivedRequest,
  seal: {
    requestHash: "sealed",
    work: { handle: previewInput.work },
    incarnation: {},
    dependencies: "deps",
  },
  takenAt: "2026-11-03T00:00:00Z",
});
function previewReceipt(key: string, input: unknown, result: unknown) {
  const receipt = actionReceiptSchema.parse({
    id: "preview-receipt",
    key,
    input,
    target: previewTarget,
    state: "succeeded",
    result,
    caller: { kind: "human", via: "local" },
    basis: null,
    steps: [],
    prepared: { state: "unprepared" },
    recovery: [],
    startedAt: "2026-11-03T00:00:00Z",
  });
  if (receipt.state !== "succeeded") throw Error("Invalid test receipt");
  return receipt;
}

function openPreview(
  key: "data-table.apply.preview" | "ducts.preview-losses" | "families.apply.preview",
  input = previewInput,
) {
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(
    issuer.scope({ target: previewTarget, work: input.work.key }),
    "preview",
    1,
  );
  if (!attempt.ok) throw Error(attempt.reason);
  const services = sourceRouteServices({});
  const request = {
    key: { op: key, sortedKeyInput: JSON.stringify(input), freshnessGeneration: 1 },
    output: commands[key].result,
  } as unknown as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, attempt.value);
  const deliver = vi.fn();
  const release = services.readings.subscribe(request, attempt.value, deliver);
  return {
    read,
    deliver,
    close() {
      release();
      read.release();
    },
  };
}

test.each([
  [
    "data-table.apply.preview",
    { table: { name: "Loads", columns: [], rows: [{ key: "a" }], pruneMissingRows: true } },
  ],
  ["ducts.preview-losses", { edits: [{ element: "duct-A", size: 12 }] }],
  ["families.apply.preview", { familyNames: ["Pump"] }],
] as const)(
  "%s publishes sealed result and receipt with exact Work/target",
  async (key, derivedRequest) => {
    const input = {
      work: {
        ...previewInput.work,
        key: {
          ...previewInput.work.key,
          route: key.startsWith("families")
            ? "families"
            : key.startsWith("ducts")
              ? "ducts"
              : "data-tables",
        },
      },
    };
    const result = previewResult(derivedRequest);
    const submit = vi
      .spyOn(actions, "submitAction")
      .mockImplementation(async (admission) =>
        previewReceipt(admission.key, admission.input, result),
      );
    const native = vi.spyOn(host, "hostFetch");
    const f = openPreview(key, input);
    try {
      await vi.waitFor(() =>
        expect(f.deliver).toHaveBeenCalledWith(
          expect.objectContaining({
            status: "ready",
            value: result,
            receipt: expect.objectContaining({ id: "preview-receipt", result, steps: [] }),
          }),
        ),
      );
      expect(submit).toHaveBeenCalledExactlyOnceWith({
        id: expect.any(String),
        key,
        target: previewTarget,
        input,
      });
      expect(f.read.read()).toEqual(f.deliver.mock.calls[0]![0]);
      expect(native).not.toHaveBeenCalled();
    } finally {
      f.close();
      submit.mockRestore();
      native.mockRestore();
    }
  },
);

test("semantic preview retains a typed stale Work refusal and receipt", async () => {
  const refusal = { kind: "stale_revision" as const, handle: previewInput.work, live: 8 };
  const {
    result: _,
    outcome: _outcome,
    ...base
  } = previewReceipt("data-table.apply.preview", previewInput, {});
  const row = actionReceiptSchema.parse({
    ...base,
    state: "failed",
    error: "Work changed",
    status: 409,
    refusal,
  });
  const submit = vi.spyOn(actions, "submitAction").mockResolvedValue(row);
  const f = openPreview("data-table.apply.preview");
  try {
    await vi.waitFor(() =>
      expect(f.deliver).toHaveBeenCalledWith({
        status: "failed",
        current: false,
        reason: "Work changed",
        refusal,
        receipt: row,
      }),
    );
  } finally {
    f.close();
    submit.mockRestore();
  }
});

test("semantic preview exposes typed admission refusal", async () => {
  const refusal = { code: "acquisition.unproven", door: "preview", reason: "Document closed" };
  const submit = vi
    .spyOn(actions, "submitAction")
    .mockRejectedValue(Object.assign(Error("Document closed"), { refusal }));
  const f = openPreview("data-table.apply.preview");
  try {
    await vi.waitFor(() =>
      expect(f.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", refusal }),
      ),
    );
  } finally {
    f.close();
    submit.mockRestore();
  }
});

test("undecodable preview retains receipt and released preview cannot deliver", async () => {
  const row = previewReceipt("data-table.apply.preview", previewInput, { previewOnly: false });
  const submit = vi.spyOn(actions, "submitAction").mockResolvedValue(row);
  const f = openPreview("data-table.apply.preview");
  try {
    await vi.waitFor(() =>
      expect(f.deliver).toHaveBeenCalledWith(
        expect.objectContaining({ status: "failed", receipt: row }),
      ),
    );
    const retired = openPreview("data-table.apply.preview");
    retired.close();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(retired.deliver).not.toHaveBeenCalled();
  } finally {
    f.close();
    submit.mockRestore();
  }
});

test("progressive publications stay inspectable but only fresh completion is current", () => {
  let publish!: ReadingDelivery;
  const services = sourceRouteServices({
    progressive: {
      kind: "use",
      open(_, deliver) {
        publish = deliver;
      },
    },
  });
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(
    issuer.scope({ target: { kind: "host" }, work: null }),
    "progressive",
    1,
  );
  if (!attempt.ok) throw Error(attempt.reason);
  const request = {
    key: { op: "progressive", sortedKeyInput: "{}", freshnessGeneration: 1 },
  } as ResolvedRead<unknown>;
  const read = services.reads.acquire(request, attempt.value);
  const delivered = vi.fn();
  const release = services.readings.subscribe(request, attempt.value, delivered);
  const check = (expected: object) => {
    expect(read.read()).toMatchObject(expected);
    expect(delivered).toHaveBeenLastCalledWith(read.read());
  };
  try {
    publish({ kind: "part", value: { records: [1] }, revision: 1 });
    check({ current: false, value: { records: [1] } });
    // Parts already carry the source's accumulated value; never append it again.
    publish({ kind: "part", value: { records: [1, 2] }, revision: 2 });
    check({ current: false, value: { records: [1, 2] } });
    for (const kind of ["stale", "pending"] as const) {
      publish({ kind: "complete", value: { records: [1, 2] }, revision: 3 });
      check({ status: "ready", current: true });
      publish({ kind });
      check({ current: false, value: { records: [1, 2] } });
    }
    publish({ kind: "failure", error: Error("Read failed") });
    check({
      status: "failed",
      current: false,
      value: { records: [1, 2] },
      reason: "Error: Read failed",
    });
    // Cancelled Families reads are retained parts, not a separate publication kind.
    publish({
      kind: "part",
      value: { records: [1, 2], progress: { state: "cancelled" } },
      revision: 4,
    });
    check({ current: false, value: { records: [1, 2], progress: { state: "cancelled" } } });
    publish({ kind: "failure", error: new DOMException("Stopped", "AbortError") });
    check({ status: "failed", current: false, value: { records: [1, 2] } });
    publish({ kind: "complete", value: { records: [3] }, revision: 5, fresh: false });
    check({ current: false, value: { records: [3] } });
    publish({ kind: "complete", value: { records: [4] }, revision: 6 });
    check({ current: true, value: { records: [4] } });
    const calls = delivered.mock.calls.length;
    publish({ kind: "log", value: "diagnostic" });
    expect(delivered).toHaveBeenCalledTimes(calls);
    check({ current: true, value: { records: [4] } });
    release();
    publish({ kind: "part", value: { records: [5] }, revision: 7 });
    expect(delivered).toHaveBeenCalledTimes(calls);
    check({ current: true, value: { records: [4] } });
  } finally {
    release();
    read.release();
  }
});

import { sourceReadingEvidence } from "./source-route-services";

test("K4 resolve generation observations use host descriptors and dispose polling transport", async () => {
  vi.useFakeTimers();
  const target = { kind: "document" as const, ref: { session: "s", openId: "d" } };
  const issuer = createRouteTokenIssuer();
  const attempt = issuer.attempt(issuer.scope({ target, work: null }), "status", 1);
  if (!attempt.ok) throw Error(attempt.reason);
  const services = sourceRouteServices({});
  const request = {
    key: { op: "revit.detail.space-status", sortedKeyInput: "{}", freshnessGeneration: 1 },
  } as ResolvedRead<unknown>;
  let generation = "first";
  const fetch = vi.spyOn(host, "hostFetch").mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          operationKey: request.key.op,
          processIncarnation: { pid: 1, startedAt: 1 },
          openDocumentLifetime: { openId: "d" },
          normalizedInput: "{}",
          freshnessGeneration: generation,
          representation: "overview",
        }),
      ),
  );
  const deliver = vi.fn();
  const release = sourceReadingEvidence(services)!.observe(request, attempt.value, deliver);
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(deliver).toHaveBeenLastCalledWith({ kind: "generation", value: "first" });
    generation = "second";
    await vi.advanceTimersByTimeAsync(5000);
    expect(deliver).toHaveBeenLastCalledWith({ kind: "generation", value: "second" });
    const count = fetch.mock.calls.length;
    release();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledTimes(count);
    expect((fetch.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true);
  } finally {
    release();
    fetch.mockRestore();
    vi.useRealTimers();
  }
});

test.each(["worker", "port"] as const)(
  "K4 %s resources release without native cancellation",
  async (kind) => {
    const dispose = vi.fn();
    const services = sourceRouteServices({
      resource:
        kind === "worker"
          ? {
              kind,
              algorithmVersion: "1",
              connect: () => ({
                update: (_context, deliver) =>
                  deliver({ kind: "complete", value: "value", revision: 0 }),
                stop: dispose,
              }),
            }
          : { kind, open: () => ({ value: "value", close: dispose }) },
    });
    const issuer = createRouteTokenIssuer();
    const attempt = issuer.attempt(
      issuer.scope({ target: { kind: "host" }, work: null }),
      "resource",
      1,
    );
    if (!attempt.ok) throw Error(attempt.reason);
    const request = {
      key: { op: "resource", sortedKeyInput: "{}", freshnessGeneration: 1 },
    } as ResolvedRead<unknown>;
    const handle = services.reads.acquire(request, attempt.value);
    const release = services.readings.subscribe(request, attempt.value, () => {});
    await Promise.resolve();
    expect(handle.read()).toMatchObject({ current: true, value: "value" });
    release();
    handle.release();
    await Promise.resolve();
    expect(dispose).toHaveBeenCalledOnce();
  },
);
