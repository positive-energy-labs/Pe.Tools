import { describe, expect, it, vi } from "vite-plus/test";
import { createPodRouteLoader, verifyBundle } from "./pod-loader";
import { actionReceiptSchema, podRouteDescriptorSchema, bindWork } from "@pe/agent-contracts";
import { executePodAction } from "./pod-view";

const row = podRouteDescriptorSchema.parse({
  key: "route:@test/routes/tool/index.js",
  workRoute: "pod.test.tool",
  packageId: "test",
  name: "Tool",
  description: "Test",
  sourcePath: "routes/tool/index.js",
  sha256: "a".repeat(64),
  trusted: true,
});

describe("Pod route byte custody", () => {
  it("rejects a schema-valid receipt for a different document than the route action admitted", async () => {
    const work = {
      key: bindWork(row.workRoute, null, "calculator"),
      revision: 3,
      doc: null,
      refusal: null,
    };
    vi.stubGlobal("fetch", async (_url: unknown, request: RequestInit) => {
      const sent = JSON.parse(request.body as string);
      return Response.json(
        actionReceiptSchema.parse({
          id: sent.id,
          kind: "operation",
          key: sent.key,
          request: sent.input,
          bases: sent.bases,
          destination: { kind: "document", ref: { session: "s", openId: "different" } },
          caller: { kind: "human", via: "local" },
          basis: { kind: "human" },
          state: "succeeded",
          result: {},
          steps: [],
          recovery: [],
          preparation: { state: "ready", value: {} },
          publication: { state: "unrequested" },
          startedAt: "2026-10-14T00:00:00.000Z",
        }),
      );
    });
    try {
      await expect(
        executePodAction(
          { target: { kind: "document", ref: { session: "s", openId: "original" } }, work },
          "revit.context.lens",
          {},
        ),
      ).rejects.toThrow("conflicts with the requested intent");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("never imports untrusted bytes and disposes a changed or disabled route", async () => {
    const events: string[] = [];
    const loader = createPodRouteLoader(async (entry) => {
      events.push(`load:${entry.sha256.slice(0, 1)}`);
      return () => {
        events.push(`dispose:${entry.sha256.slice(0, 1)}`);
      };
    });
    await loader.sync([{ ...row, trusted: false }]);
    expect(events).toEqual([]);
    await loader.sync([row]);
    await loader.sync([podRouteDescriptorSchema.parse({ ...row, sha256: "b".repeat(64) })]);
    await loader.sync([]);
    expect(events).toEqual(["load:a", "dispose:a", "load:b", "dispose:b"]);
  });
  it("disposes an import that finishes after removal, without resurrecting it", async () => {
    let resolve!: (dispose: () => void) => void;
    let disposed = false;
    const loader = createPodRouteLoader(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const pending = loader.sync([row]);
    await loader.sync([]);
    resolve(() => {
      disposed = true;
    });
    await pending;
    expect(disposed).toBe(true);
  });
  it("checks the received bytes against the trusted hash before import", async () => {
    const bytes = new TextEncoder().encode("export const version = 1;");
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const trusted = podRouteDescriptorSchema.parse({ ...row, sha256 });
    await expect(verifyBundle(bytes, trusted.sha256)).resolves.toBeUndefined();
    await expect(
      verifyBundle(new TextEncoder().encode("export const version = 2;"), trusted.sha256),
    ).rejects.toThrow("changed");
  });
});
