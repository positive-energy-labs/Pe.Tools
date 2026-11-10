// @vitest-environment jsdom
// ADR 0030 rule 6 on the real Fans route: the shared write button plans sheet.plan with Fans' own Work
// as `work` and nothing else. /fans owns no /ducts Work (ruling 2026-11-10), so the host reads the /ducts
// design itself and seals it (ducts-actions.ts: the sibling from readWorks, else the host's own view).
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { WorkHandle } from "@pe/agent-contracts";
import { createWitness } from "./cutover.test-support";

const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);

test("Fans plans losses through its own handle alone; no /ducts handle rides from /fans", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  f.fans.invoke("edit", { patches: [{ path: ["writeIntent"], value: { edit: { value: { walk: { unitId: 1, portIndex: 0 } } } } }] }, f.fans.workBasis()!);
  await vi.waitFor(() =>
    expect(f.fans.work()?.value).toMatchObject({
      writeIntent: { edit: { value: { walk: { unitId: 1 } } } },
    }),
  );
  expect(f.fans.invoke("losses", {})).toEqual({ kind: "preview" });
  await vi.waitFor(() => expect(f.inputs.get("fans:sheet.plan")).toBeTruthy());
  const sent = f.inputs.get("fans:sheet.plan") as { work: WorkHandle; readWorks?: Record<string, WorkHandle> };
  expect(sent).toMatchObject({ work: { key: { route: "fans" }, revision: f.fans.work()!.revision } });
  expect(Object.keys(sent.readWorks ?? {})).toEqual([]);
});

// H2: a cold reopen mints a new openId while the stored Work identity (address) stays. The human plan
// must submit the handle its owner feed returned, so the host's raw fence (ducts-actions.ts) admits it.
test("after a reopen the human plan sends its owner feed's handle, which the host fence admits", async () => {
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
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  await vi.waitFor(() =>
    expect(f.fans.work()?.value).toMatchObject({ writeIntent: { edit: { value: { walk: { unitId: 1 } } } } }),
  );
  expect(f.fans.invoke("losses", {})).toEqual({ kind: "preview" });
  await vi.waitFor(() => expect(f.inputs.get("fans:sheet.plan")).toBeTruthy());
  const sent = f.inputs.get("fans:sheet.plan") as { work: WorkHandle; readWorks?: Record<string, WorkHandle> };
  expect(sent.work).toEqual(f.fans.work()!.handle);
  expect(Object.keys(sent.readWorks ?? {})).toEqual([]);
});
