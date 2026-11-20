import { expect, test, vi } from "vite-plus/test";
import { module as fans } from "../../../../../../products/fans/web/route.ts";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { mountTypedRoute } from "../../../shell/typed-mount.ts";

test("a lazy fans fixture initializes its Value and Work without native reads", async () => {
  vi.stubGlobal("fetch", () => { throw Error("Fixture called the host"); });
  const mount = mountTypedRoute(fans, {
    fixture: "scene", target: { kind: "document", ref: { session: "fixture", openId: "clinic" } },
    work: { address: null, open: { session: "fixture", openId: "clinic" } },
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    memory: () => ({}), custody: { current: () => true },
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`));
  try {
    await vi.waitFor(() => {
      expect(mount.value().state).toBe("ready");
      expect(mount.owner()?.ready).toBe(true);
    });
  } finally { mount.dispose(); vi.unstubAllGlobals(); }
});
