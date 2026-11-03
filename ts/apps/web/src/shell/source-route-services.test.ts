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
