// @vitest-environment jsdom
// ADR 0030 rule 6 on the real Fans route: the shared write button plans ducts.plan-losses with the
// ducts owner's Work as `work` and Fans' own Work as `readWorks.fans` (V2: ducts owns the command).
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createWitness } from "./cutover.test-support";

const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

test("Fans plans losses through the ducts owner handle and its own handle as readWorks.fans", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("ductsWork").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  f.fans.invoke("scope", { walk: { unitId: 1, portIndex: 0 } }, f.fans.workBasis()!);
  await vi.waitFor(() =>
    expect(f.fans.work()?.value).toMatchObject({
      writeIntent: { edit: { value: { walk: { unitId: 1 } } } },
    }),
  );
  expect(f.fans.invoke("losses", {})).toEqual({ kind: "preview" });
  await vi.waitFor(() => expect(f.inputs.get("fans:ducts.plan-losses")).toBeTruthy());
  const owner = f.fans.readingStatus("ductsWork").snapshot as unknown as {
    handle: { key: { route: string }; revision: number };
  };
  expect(f.inputs.get("fans:ducts.plan-losses")).toMatchObject({
    work: { key: { route: "ducts" }, revision: owner.handle.revision },
    readWorks: { fans: { key: { route: "fans" }, revision: f.fans.work()!.revision } },
  });
});
