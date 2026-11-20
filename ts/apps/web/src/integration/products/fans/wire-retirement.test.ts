// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { mountTypedRoute } from "../../../shell/typed-mount.ts";
import { createWitness } from "../../../../tests/integration/products/fans/cutover.test-support.ts";

test("old Fans Page fields and stage are refused with a visible reason, without aliases", async () => {
  const closes: (() => void)[] = [];
  try {
    const f = await createWitness(closes);
    const input = f.places.get("fans")!;
    const route = f.admitted.presenter;
    for (const search of [
      new URLSearchParams({ stage: "sheet" }),
      new URLSearchParams({ sheetPath: "old-path" }),
    ]) {
      expect(() =>
        mountTypedRoute(
          route.typed,
          { ...input, memory: () => ({}), address: { ...input.address, read: () => search } },
          route.workFingerprint,
        ),
      ).toThrow("retired. Open a new Place.");
    }
    expect(() =>
      mountTypedRoute(
        route.typed,
        {
          ...input,
          memory: () => ({ sheetPath: "old-path" }),
          address: { ...input.address, read: () => new URLSearchParams() },
        },
        route.workFingerprint,
      ),
    ).toThrow("retired. Open a new Place.");
  } finally {
    closes.reverse().forEach((close) => close());
  }
});
