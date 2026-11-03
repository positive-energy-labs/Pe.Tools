import { expect, test, vi } from "vite-plus/test";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import * as host from "../host/runtime";
import { dataTablesSources } from "../data-tables/sources";
import { sourceRouteServices } from "./source-route-services";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
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
  key: "data-table.apply.preview" | "ducts.preview-losses",
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
] as const)(
  "%s publishes sealed result and receipt with exact Work/target",
  async (key, derivedRequest) => {
    const input = {
      work: {
        ...previewInput.work,
        key: { ...previewInput.work.key, route: key.startsWith("ducts") ? "ducts" : "data-tables" },
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
