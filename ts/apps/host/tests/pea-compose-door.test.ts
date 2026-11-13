import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test, vi } from "vite-plus/test";
import { peDo, buildCapabilities } from "@pe/mcps";
import { tsOnlyOperationCatalog } from "@pe/host-contracts/operation-types";
import { withInvocationContext } from "@pe/runtime/context";
import { machineFixture } from "../../../packages/agent-contracts/tests/machine-fixture.ts";
import { readAction } from "../../../packages/mcps/src/shared/takeoff-action-client.ts";
import { fixtureNative } from "./fixture-native.ts";
import { approvedPea } from "./callers.ts";
import { localRead, readLocal } from "../src/local-inputs.ts";

test("the bridge-free compose reader is available without catalog intent and refuses to resolve native directives", async () => {
  expect(() => localRead("pod.member.compose")).not.toThrow();
  expect(await readLocal("pod.member.compose", {
    path: "settings/member.json", content: JSON.stringify({ $preset: "@local/base.json" }),
  })).toMatchObject({
    composed: null, diagnostics: [expect.objectContaining({ code: "CompositionNeedsRevit" })],
  });
});

test("Pea composes a Pod member draft through actions and reads the composed result from its durable receipt", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-compose-door-"));
  const native = await fixtureNative(root);
  const caller = approvedPea("compose-door");
  const door = native.actions();
  const requests: { path: string; status: number }[] = [];
  try {
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path === "/pe/scope/self") return new Response(null, { status: 404 });
      if (path === "/pe/capabilities") return Response.json({
        at: new Date().toISOString(), machine: machineFixture([]), sources: {}, diagnostics: [],
        capabilities: buildCapabilities({ ops: [], routes: [], packages: [], skills: [] }),
      });
      if (path === "/ops") return Response.json({ operations: tsOnlyOperationCatalog });
      const response = await door.request(request, caller);
      requests.push({ path, status: response.status });
      return response;
    });
    await withInvocationContext({ caller, hostBaseUrl: "http://compose.test" }, async () => {
      const content = JSON.stringify({ $schema: "/schemas/settings/Example/member.json", width: 3 });
      const result = await peDo.execute(peDo.inputSchema.parse({
        key: "op:pod.member.compose", timeoutSeconds: 30,
        input: { pod: "example", path: "settings/member.json", content,
          schemaJson: JSON.stringify({ type: "object", properties: { width: { type: "number" } }, required: ["width"] }),
        },
      }), { agent: { toolCallId: "compose-member" } });
      expect(result, JSON.stringify({ result, requests })).toMatchObject({ ok: true });
      const receipt = await readAction("compose-member", "http://compose.test");
      expect(receipt).toMatchObject({ state: "succeeded", result: {
        source: { id: "example", path: "settings/member.json", origin: "SuppliedDraft" },
        schemaValidation: "passed", composed: JSON.stringify(JSON.parse(content), null, 2) + "\n",
      } });
      expect(requests).toContainEqual({ path: "/actions", status: 200 });
      expect(requests.some(request => request.path === "/call")).toBe(false);
    });
  } finally {
    vi.unstubAllGlobals();
    await native.close();
    await rm(root, { recursive: true, force: true });
  }
});
