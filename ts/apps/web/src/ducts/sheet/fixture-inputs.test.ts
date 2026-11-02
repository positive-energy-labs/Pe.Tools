import { expect, test, vi } from "vite-plus/test";
import { createFixtureMount } from "#/shell/fixture";
import { ductsBinding } from "../actions";
import { ductsGraph } from "../graph";
import type { SheetReading } from "../sources";

// The fixture lane re-resolves criteria from Work like the host: an edited allowance reads Work, undo reads firm.
test("editing the return allowance resolves Work, and undo resolves the firm value again", async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Host called"); }));
  const owner = await createFixtureMount(ductsGraph, "layout", { binding: ductsBinding }, { fan: "all" });
  const release = owner.connect();
  const demand = owner.readings.mount(["sheet"]);
  const allowance = () =>
    (owner.readings.get("sheet").value as SheetReading | null)?.open?.inputs?.inputs.criteria
      .allowanceInWg.return;
  try {
    await vi.waitFor(() => expect(allowance()).toMatchObject({ source: "firm" }));
    const firm = allowance()!.value;
    const sheet = owner.readings.get("sheet").value as SheetReading;
    const result = await owner
      .control("sheet-inputs", {
        edits: { criteria: { allowanceInWg: { return: 0.35 } } },
        expectedRevision: owner.snapshot().work!.handle.revision,
        basis: sheet.open!.overview.basis,
      })
      .run();
    expect(result).toMatchObject({ state: "done" });
    await vi.waitFor(() => expect(allowance()).toMatchObject({ value: 0.35, source: "Work" }));
    await owner.restore("undo");
    await vi.waitFor(() => expect(allowance()).toMatchObject({ value: firm, source: "firm" }));
  } finally {
    demand();
    release();
    owner.dispose();
    vi.unstubAllGlobals();
  }
});
