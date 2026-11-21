import { stateFixture } from "../../../tests/isolated-home/storage.ts";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { serviceHeaders, contextHeaders } from "./callers.ts";
import { fixtureNative } from "./fixture-native.ts";
import { RouteWorkspace } from "@pe/runtime";
import { address, bindWork } from "@pe/agent-contracts";
import { product, takeoffsWork } from "@pe/rooms-contract/product";
import { createPeClient } from "@pe/mcps/product-catalog";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import type { z } from "zod";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { testHostInputs, callRouteOver } from "./effect-test.ts";
import { Layer } from "effect";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { serveRoutes } from "./real-server.ts";
import * as receipts from "../src/receipt-export.ts";

let root: string, journal: ActionJournal, server: Awaited<ReturnType<typeof serveRoutes>>;
let native: Awaited<ReturnType<typeof fixtureNative>>;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
const pea = () => contextHeaders({ kind: "pea", thread: "foreign" });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-refusal-doors-"));
  native = await fixtureNative(join(root, "native"));
  journal = native.journal;
  const workspace = new RouteWorkspace({
    registrations: [{ spec: takeoffsWork }],
    store: fileRouteDocumentStore(stateFixture(join(root, "work"))),
  });
  server = await serveRoutes(
    callRouteOver(journal, undefined, { workspace }).pipe(Layer.provide(testHostInputs)),
    native.bridge,
  );
  const response = await post(
    "/actions",
    {
      id: "human-action",
      key: "work.start",
      target: { kind: "host" },
      input: {
        key: bindWork("takeoffs", address("C:/Models/guard.rvt")),
        seed: takeoffsWork.schema.parse({}),
      },
    },
    contextHeaders(),
  );
  expect([200, 202]).toContain(response.status);
  expect(await journal.wait("human-action")).toMatchObject({ state: "succeeded" });
});
afterEach(async () => {
  await server.close();
  await native.close();
  await rm(root, { recursive: true, force: true });
  expect(
    (await journal.list()).flatMap((row) => row.steps).filter((step) => step.kind === "native"),
  ).toEqual([]);
});

test("RHVAC launch requires journaled action admission for authenticated callers", async () => {
  const page = {
    origin: server.base,
    "sec-fetch-site": "same-origin",
    referer: `${server.base}/pages/refusals/`,
    ...serviceHeaders(),
  };
  for (const headers of [
    contextHeaders(),
    pea(),
    contextHeaders({ kind: "external-mcp", label: "unpaired" }),
    page,
  ]) {
    const response = await post(
      "/call",
      { key: "rhvac.launch", request: { path: "test.r10" } },
      headers,
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: "Submit the original exact admission to /actions; raw mutation dispatch is retired",
      notDispatched: true,
    });
  }
  const anonymous = await post("/call", { key: "rhvac.launch", request: { path: "test.r10" } });
  expect(anonymous.status).toBe(403);
});
test("a product's local mutation is admitted with the files its declaration names", async () => {
  const targetPath = join(root, "missing.r10");
  const response = await post(
    "/actions",
    {
      id: "sync-effects",
      key: "rhvac.sync",
      target: { kind: "host" },
      input: { targetPath, inserts: [], updates: [], whatIf: true },
    },
    contextHeaders(),
  );
  expect([200, 202]).toContain(response.status);
  // The footprint is bound at admission, whatever the sync of a missing file then answers.
  expect((await journal.wait("sync-effects")).effects).toEqual([
    { kind: "file", path: targetPath },
  ]);
});
test("an unavailable Pod query has one typed refusal before dispatch", async () => {
  const response = await post(
    "/call",
    { key: "pod.fixture.unavailable", request: {} },
    contextHeaders(),
  );
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    refusal: {
      code: "permission.undeclared",
      door: "/call",
      reason: "Pod query has no admitted route: pod.fixture.unavailable",
    },
  });
});

test("a successful /call records a succeeded host operation", async () => {
  const record = vi.spyOn(receipts, "recordHostFact").mockImplementation(() => {});
  try {
    const response = await post("/call", { key: "takeoffs.saved", request: {} }, contextHeaders());
    expect(response.status).toBe(200);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "host_op",
        counters: expect.objectContaining({
          op: "takeoffs.saved",
          outcome: "succeeded",
        }),
      }),
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  } finally {
    record.mockRestore();
  }
});
test("the catalog client reads saved and live observations with the declared product type", async () => {
  const client = createPeClient(server.base, (url, init) => {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(contextHeaders())) headers.set(key, value);
    return fetch(url, { ...init, headers });
  });
  const saved = await client.call("takeoffs.observations", { query: { saved: true } });
  expectTypeOf(saved).toEqualTypeOf<z.output<typeof product.readings.observations.handle.data>>();
  expect(saved).toEqual([]);
  const target = { session: "observed-session", openId: "observed-document" };
  const live = await client.call(
    "takeoffs.observations",
    {},
    {
      headers: {
        [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
        [HOST_RPC_DOCUMENT_HEADER]: target.openId,
      },
    },
  );
  expect(live).toEqual({ kind: "empty", target });
});
test("action controls cannot borrow a human receipt across caller threads", async () => {
  for (const verb of ["cancel"]) {
    const response = await post(`/actions/${verb}`, { id: "human-action" }, pea());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      notDispatched: true,
      refusal: {
        code: "context.foreign-thread",
        door: "/actions",
        reason: "This command belongs to another authenticated caller",
      },
    });
  }
  expect((await journal.list(undefined, "human-action"))[0]!.state).toBe("succeeded");
});
