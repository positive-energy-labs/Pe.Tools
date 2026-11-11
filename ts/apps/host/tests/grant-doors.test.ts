import { serviceHeaders, contextHeaders } from "./callers.ts";
import { fixtureNative } from "./fixture-native.ts";
import { RouteWorkspace } from "@pe/runtime";
import { address, bindWork, tools } from "@pe/agent-contracts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { testHostInputs, callRouteOver } from "./effect-test.ts";
import { Layer } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { ActionJournal } from "../src/action-journal.ts";
import { serveRoutes } from "./real-server.ts";

let root: string, journal: ActionJournal, server: Awaited<ReturnType<typeof serveRoutes>>;
let native: Awaited<ReturnType<typeof fixtureNative>>;
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const pea = () => contextHeaders({ kind: "pea", thread: "foreign" });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-refusal-doors-"));
  native = await fixtureNative(join(root, "native"));
  journal = native.journal;
  const workspace = new RouteWorkspace({ registrations: [{ spec: tools.takeoffs.work }], store: fileRouteDocumentStore(join(root, "work")) });
  server = await serveRoutes(callRouteOver(journal, undefined, { workspace }).pipe(Layer.provide(testHostInputs)), native.bridge);
  const response = await post("/actions", { id: "human-action", key: "work.start", target: { kind: "host" },
    input: { key: bindWork("takeoffs", address("C:/Models/guard.rvt")), seed: tools.takeoffs.work.schema.parse({}) } },
    contextHeaders());
  expect([200, 202]).toContain(response.status);
  expect(await journal.wait("human-action")).toMatchObject({ state: "succeeded" });
});
afterEach(async () => {
  await server.close();
  await native.close();
  await rm(root, { recursive: true, force: true });
  expect((await journal.list()).flatMap(row => row.steps).filter(step => step.kind === "native")).toEqual([]);
});

test("RHVAC launch refuses every non-human caller before dispatch", async () => {
  const page = { origin: server.base, "sec-fetch-site": "same-origin", referer: `${server.base}/pages/refusals/`, ...serviceHeaders() };
  for (const headers of [{}, pea(), contextHeaders({ kind: "external-mcp", label: "unpaired" }), page]) {
    const response = await post("/call", { key: "rhvac.launch", request: { path: "test.r10" } }, headers);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only a person can launch RHVAC", notDispatched: true });
  }
});
test("an unavailable Pod query has one typed refusal before dispatch", async () => {
  const response = await post("/call", { key: "pod.fixture.unavailable", request: {} }, contextHeaders());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ refusal: { code: "permission.undeclared", door: "/call",
    reason: "Pod query has no admitted route: pod.fixture.unavailable" } });
});
test("action controls cannot borrow a human receipt across caller threads", async () => {
  for (const verb of ["resume", "cancel", "recover"]) {
    const response = await post(`/actions/${verb}`, { id: "human-action" }, pea());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ notDispatched: true, refusal: { code: "context.foreign-thread",
      door: "/actions", reason: "This command belongs to another authenticated caller" } });
  }
  expect((await journal.list(undefined, "human-action"))[0]!.state).toBe("succeeded");
});
