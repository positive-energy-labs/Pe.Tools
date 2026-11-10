// @vitest-environment jsdom
// ADR 0030 rule 6 on the real Fans route: the shared write button plans sheet.plan with Fans' own
// Work as `work` and the ducts owner's Work as `readWorks.ducts` (slice 7: the sheet pair is every route's door).
import { afterEach, expect, test, vi } from "vite-plus/test";
import { canonicalRouteInput } from "../../../../packages/agent-contracts/src/route-doc";
import type { WorkHandle } from "@pe/agent-contracts";
import { createWitness } from "./cutover.test-support";

const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

test("Fans plans losses through its own handle and the ducts owner handle as readWorks.ducts", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("owner:ducts").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  f.fans.invoke("edit", { patches: [{ path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 1, portIndex: 0 } } } } }] }, f.fans.workBasis()!);
  await vi.waitFor(() =>
    expect(f.fans.work()?.value).toMatchObject({
      writeIntent: { edit: { value: { walk: { unitId: 1 } } } },
    }),
  );
  expect(f.fans.invoke("losses", {})).toEqual({ kind: "preview" });
  await vi.waitFor(() => expect(f.inputs.get("fans:sheet.plan")).toBeTruthy());
  const owner = f.fans.readingStatus("owner:ducts").snapshot as unknown as {
    handle: { key: { route: string }; revision: number };
  };
  expect(f.inputs.get("fans:sheet.plan")).toMatchObject({
    work: { key: { route: "fans" }, revision: f.fans.work()!.revision },
    readWorks: { ducts: { key: { route: "ducts" }, revision: owner.handle.revision } },
  });
});

// H2: a cold reopen mints a new openId while the stored Work identity (address) stays. The human plan
// must submit the handles its owner feeds returned, so the host's raw fence (ducts-actions.ts) admits it.
test("after a reopen the human plan sends both owner feeds' handles, which the host fence admits", async () => {
  const saved = new Map<string, unknown>();
  const address = "C:/Models/Plant.rvt" as never;
  const first: (() => void)[] = [];
  const before = await createWitness(first, saved, {}, { address, open: { session: "s", openId: "first" } });
  await vi.waitFor(() => expect(before.fans.workBasis()).toBeTruthy());
  before.fans.invoke("edit", { patches: [{ path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 1, portIndex: 0 } } } } }] }, before.fans.workBasis()!);
  await vi.waitFor(() => expect(saved.get("fans")).toMatchObject({
    doc: { writeIntent: { edit: { value: { walk: { unitId: 1, portIndex: 0 } } } } },
  }));
  first.reverse().forEach((close) => close());
  const f = await createWitness(closes, saved, {}, { address, open: { session: "s", openId: "reopened" } });
  await vi.waitFor(() => expect(f.fans.readingStatus("owner:ducts").snapshot.current).toBe(true));
  await vi.waitFor(() =>
    expect(f.fans.work()?.value).toMatchObject({ writeIntent: { edit: { value: { walk: { unitId: 1 } } } } }),
  );
  expect(f.fans.invoke("losses", {})).toEqual({ kind: "preview" });
  await vi.waitFor(() => expect(f.inputs.get("fans:sheet.plan")).toBeTruthy());
  const sent = f.inputs.get("fans:sheet.plan") as { work: WorkHandle; readWorks: { ducts: WorkHandle } };
  expect(sent.work).toEqual(f.fans.work()!.handle);
  expect(canonicalRouteInput(sent.readWorks.ducts.key)).toBe(canonicalRouteInput({ ...sent.work.key, route: "ducts" }));
});
