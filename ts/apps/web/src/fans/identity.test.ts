import { expect, test, vi } from "vite-plus/test";
import { createFixtureMount } from "#/shell/fixture";
import { fansGraph } from "./graph";
import { stableFanKey } from "../ducts/sheet/model";
import type { SheetReading } from "../ducts/sources";
import sheetFixture from "../ducts/sheet/sheet.fixture.json";

test("Fans fixture opens both FC-23 subjects and retains Work and ledger across a failed pick", async () => {
  const owner = await createFixtureMount(fansGraph, "scene");
  const release = owner.connect();
  const demand = owner.readings.mount(["sheet"]);
  try {
    const duplicate = sheetFixture.roster.rows.filter((row) => row.mark === "FC-23");
    owner.view.setPage({ fan: duplicate.map(stableFanKey) });
    await vi.waitFor(() => expect(owner.readings.get("sheet").current).toBe(true));
    const both = owner.readings.get("sheet").value as SheetReading;
    expect(both.opened?.map((sheet) => sheet.overview.fan?.unitId)).toEqual([22, 13760867]);
    expect(new Set(both.rows.map(stableFanKey)).size).toBe(both.rows.length);
    const work = owner.snapshot().work;
    owner.view.setPage({ fan: [stableFanKey(sheetFixture.roster.rows[0]!)] });
    await vi.waitFor(() => expect((owner.readings.get("sheet").value as SheetReading).open?.overview.fan?.mark).toBe("MUAS-1"));
    const muas = owner.readings.get("sheet").value;
    owner.view.setPage({ fan: [stableFanKey(sheetFixture.roster.rows[0]!), "13760867:1"] });
    await vi.waitFor(() => expect(owner.readings.get("sheet").status).toBe("failed"));
    expect(owner.readings.get("sheet").error).toContain("13760867:1");
    expect(owner.readings.get("sheet").previous).toBe(muas);
    expect(owner.snapshot().work).toBe(work);
    expect((owner.readings.get("fans").value as { rows: unknown[] }).rows).toHaveLength(sheetFixture.roster.rows.length);
  } finally {
    demand(); release(); owner.dispose();
  }
});


test("layout stress roster gives every synthetic unit its own stable identity", async () => {
  const owner = await createFixtureMount(fansGraph, "layout");
  const release = owner.connect();
  const demand = owner.readings.mount(["fans"]);
  try {
    await vi.waitFor(() => expect(owner.readings.get("fans").current).toBe(true));
    const rows = (owner.readings.get("fans").value as SheetReading).rows;
    expect(new Set(rows.map(stableFanKey)).size).toBe(rows.length);
  } finally {
    demand(); release(); owner.dispose();
  }
});
