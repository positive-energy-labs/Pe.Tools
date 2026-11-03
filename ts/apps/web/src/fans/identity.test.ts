import { afterEach, expect, test, vi } from "vite-plus/test";
import { createWitness } from "./cutover.test-support";
import { admit } from "./admission.fixture";
import { localId } from "../ducts/neutral";
import { stableFanKey } from "../ducts/sheet/model";
import { workFeedFailureMessage } from "../../../../packages/agent-contracts/src/work-journal-door";
import fixture from "../ducts/sheet/sheet.fixture.json";
const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);
const picked = (keys: string[]) => ({
  kind: "ids" as const,
  ids: keys.map((key) => localId("ducts-fan", key)),
});
test("P06/P08: MUAS-1 restores from a direct URL and duplicate FC-23 ports have distinct picker labels", async () => {
  const f = await createWitness(closes);
  const muas = fixture.roster.rows.find((row) => row.mark === "MUAS-1")!;
  const value = picked([stableFanKey(muas)]);
  const mounted = f.mount(
    f.admitted.presenter,
    new URLSearchParams({ fan: JSON.stringify(value) }),
    "direct",
  );
  await vi.waitFor(() =>
    expect((mounted.picker("fan") as readonly unknown[] | undefined)?.length).toBeGreaterThan(0),
  );
  expect(mounted.page.read().fan).toEqual(value);
  const twins = fixture.roster.rows.filter((row) => row.mark === "FC-23");
  const options = mounted.picker("fan") as readonly { id: string; label: string }[];
  const twinOptions = options.filter((option) =>
    twins.some((twin) => option.id === localId("ducts-fan", stableFanKey(twin))),
  );
  expect(twinOptions).toHaveLength(2);
  expect(new Set(twinOptions.map((option) => option.label)).size).toBe(2);
  mounted.close();
  expect(f.mount(f.admitted.presenter, undefined, "direct").page.read().fan).toEqual(value);
});
test("P08: all and explicit none survive address reload independently", async () => {
  const f = await createWitness(closes);
  expect(f.fans.controls.subject({ kind: "all" })).toMatchObject({ kind: "accepted" });
  f.fans.close();
  const all = f.mount(f.admitted.presenter);
  expect(all.page.read().fan).toEqual({ kind: "all" });
  expect(all.controls.subject({ kind: "ids", ids: [] })).toMatchObject({ kind: "accepted" });
  all.close();
  expect(f.mount(f.admitted.presenter).page.read().fan).toEqual({ kind: "ids", ids: [] });
});
test("P07/P12: two retained Places keep separate subject, selection, query and pose over one Work", async () => {
  const f = await createWitness(closes);
  const ids = fixture.roster.rows.slice(0, 2).map(stableFanKey);
  const a = f.mount(
    f.admitted.presenter,
    new URLSearchParams({ fan: JSON.stringify(picked([ids[0]!])) }),
    "a",
  );
  const b = f.mount(
    f.admitted.presenter,
    new URLSearchParams({ fan: JSON.stringify(picked([ids[1]!])) }),
    "b",
  );
  a.page.select([{ kind: "focus", id: localId("ducts-focus", "7") }]);
  a.page.pose({ contextRadiusFt: 15 }, "gesture");
  a.controls.query("inputSort", "name");
  expect(b.page.read()).toMatchObject({
    fan: picked([ids[1]!]),
    selected: [],
    contextRadiusFt: 10,
    inputSort: "",
  });
  a.close();
  expect(f.mount(f.admitted.presenter, undefined, "a").page.read()).toMatchObject({
    fan: picked([ids[0]!]),
    contextRadiusFt: 15,
    inputSort: "name",
  });
});
test("a stale Fans tab gets a reload refusal before any edit", async () => {
  const f = await createWitness(closes);
  const changed = await admit("fans-new-build");
  const stale = f.mount(changed.presenter, undefined, "stale");
  await vi.waitFor(() =>
    expect(stale.workFailure()).toMatchObject({ kind: "registration-mismatch" }),
  );
  expect(workFeedFailureMessage(stale.workFailure()!)).toMatch(/Reload this tab/);
  expect(stale.workBasis()).toBeNull();
});
