import { testHostInputs } from "./effect-test.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActionJournal } from "../src/action-journal.ts";
import { Layer, Effect } from "effect";
import { expect, test } from "vite-plus/test";
import { withInvocationContext } from "@pe/runtime/context";
import { HOST_CONTEXT_HEADER } from "@pe/host-contracts/contracts";
import { ductsNativeRead } from "../src/ducts-analysis.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { mintContext } from "../src/control.ts";
import { hostOwnership } from "../src/host-ownership.ts";
import { detachedBridge, sessionView } from "./effect-test.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { serveRoutes } from "./real-server.ts";

test("the analysis read adapter preserves Pea admission and never borrows a human principal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-ducts-analysis-"));
  let nativeReads = 0;
  const bridge = detachedBridge({
    list: Effect.succeed([
      sessionView({
        sessionId: "bridge-a",
        connected: true,
        lane: hostOwnership.lane,
        sourceRoot: hostOwnership.sourceRoot,
        serviceName: hostOwnership.serviceName,
        processId: 42,
        processStartUtcUnixMs: 1000,
        state: {
          openDocuments: [
            { openId: "open-a", address: "C:/HVAC.rvt", title: "HVAC", isFamilyDocument: false },
          ],
        },
      }),
    ]),
    invoke: (key: string) =>
      Effect.promise(async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        if (key === "host.ops.catalog")
          return {
            value: {
              operations: [
                {
                  key: "ducts.snapshot.walk",
                  intent: "Read", subject: "Elements", touches: "Geometry", effect: "Read", cardinality: "One", costTier: "Bounded",
                  needs: "project-document",
                  actor: "human",
                },
              ],
            },
            target: { session: "bridge-a", document: null },
          };
        nativeReads++;
        return {
          value: { fixture: true },
          target: {
            session: "bridge-a",
            document: "C:/HVAC.rvt",
            documentRef: { session: "bridge-a", openId: "open-a" },
          },
        };
      }),
  });
  const server = await serveRoutes(
    makeCallRoute(new ActionJournal(join(dir, "journal.jsonl"), Date.now), undefined, { sdk: sdkSessions }).pipe(Layer.provide(testHostInputs)),
    bridge,
  );
  try {
    const call = ductsNativeRead(server.base);
    const target = { session: "bridge-a", openId: "open-a" };
    const pea = await withInvocationContext(
      {
        hostBaseUrl: server.base,
        headers: {
          [HOST_CONTEXT_HEADER]: mintContext({ kind: "pea", thread: "analysis-fixture" }),
        },
      },
      () => call("ducts.snapshot.walk", { selector: { kind: "ids", ids: [1] } }, target),
    );
    expect(pea.status, await pea.clone().text()).toBe(403);
    expect(pea.headers.get("x-pe-native-request-id")).toBeNull();
    expect(nativeReads).toBe(0);
    const human = await withInvocationContext(
      {
        hostBaseUrl: server.base,
        headers: { [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }) },
      },
      () => call("ducts.snapshot.walk", { selector: { kind: "ids", ids: [1] } }, target),
    );
    expect(human.status, await human.clone().text()).toBe(200);
    expect(human.headers.get("x-pe-native-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    // Pea cannot borrow the human-only operation; the human performs the first native read.
    expect(nativeReads).toBe(1);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}, 30_000);
