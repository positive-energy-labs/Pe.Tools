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
