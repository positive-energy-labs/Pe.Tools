import { expect, test, vi } from "vite-plus/test";
import { createRouteOwner, makeAtomRegistry } from "#/shell/owner";

const admissions = vi.hoisted(() => vi.fn(async () => []));
vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  cancelRunningAdmissions: admissions,
}));

test("Stop cancels the exact registered read and holds custody until its native result settles", async () => {
  const registry = makeAtomRegistry();
  const owner = createRouteOwner("families", registry);
  const cancel = vi.fn(async () => {});
  let finish!: () => void;
  try {
    const waiting = owner.runAction("read", async (cancelWith) => {
      cancelWith(cancel);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return null;
    });
    owner.stop();
    await waiting;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(admissions).not.toHaveBeenCalled();
    expect(registry.get(owner.busy)?.key).toBe("read");
    finish();
    await vi.waitFor(() => expect(registry.get(owner.busy)).toBeNull());
  } finally {
    owner.dispose();
  }
});

test("a refused read cancellation leaves the read running and reports the refusal", async () => {
  const registry = makeAtomRegistry();
  const owner = createRouteOwner("families", registry);
  let finish!: () => void;
  try {
    const waiting = owner.runAction("read", async (cancelWith) => {
      cancelWith(async () => {
        throw Error("read belongs to another document");
      });
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return null;
    });
    owner.stop();
    await vi.waitFor(() =>
      expect(registry.get(owner.log).some((row) => row.says.includes("stop refused"))).toBe(true),
    );
    expect(registry.get(owner.busy)?.key).toBe("read");
    finish();
    await waiting;
    expect(registry.get(owner.busy)).toBeNull();
  } finally {
    owner.dispose();
  }
});
