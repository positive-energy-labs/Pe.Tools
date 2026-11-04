import { describe, expect, it } from "vite-plus/test";
import { createPodRouteLoader } from "./pod-loader";
import { podRouteDescriptorSchema } from "@pe/agent-contracts";

const row = podRouteDescriptorSchema.parse({
  key: "route:@test/routes/tool/route.artifact",
  workRoute: "pod.test.tool",
  packageId: "test",
  name: "Tool",
  description: "Test",
  artifact: "routes/tool/route.artifact",
  fingerprint: `pod-bytes:${"a".repeat(64)}`,
  trusted: true,
});

describe("Pod route byte custody", () => {
  it("never imports untrusted bytes and disposes a changed or disabled route", async () => {
    const events: string[] = [];
    const loader = createPodRouteLoader(async (entry) => {
      events.push(`load:${entry.fingerprint.slice(-1)}`);
      return () => {
        events.push(`dispose:${entry.fingerprint.slice(-1)}`);
      };
    });
    await loader.sync([{ ...row, trusted: false }]);
    expect(events).toEqual([]);
    await loader.sync([row]);
    await loader.sync([
      podRouteDescriptorSchema.parse({ ...row, fingerprint: `pod-bytes:${"b".repeat(64)}` }),
    ]);
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
});
