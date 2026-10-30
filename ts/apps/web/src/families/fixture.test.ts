import { expect, test, vi } from "vite-plus/test";
import { createFixtureMount } from "#/shell/fixture";
import { familiesGraph } from "./graph";
test("families graph seeds supply the matrix and editable in-memory Work", async () => {
  const fetch = vi.fn(() => {
    throw Error("Host called");
  });
  vi.stubGlobal("fetch", fetch);
  const owner = await createFixtureMount(familiesGraph, "apply", {
    binding: (_, row) => ({ subject: null, args: row ?? {} }),
  });
  const release = owner.connect();
  const demand = owner.readings.mount(["matrix"]);
  try {
    expect(owner.readings.get("matrix").value).toMatchObject({
      result: { families: expect.any(Array) },
    });
    expect((await owner.control("exclude", undefined).run()).state).toBe("refused");
    expect(
      (await owner.control("exclude", { name: "Air Handler", refusal: null }).run()).state,
    ).toBe("done");
    expect(owner.snapshot().work?.doc.excluded).toHaveProperty("Air Handler");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    demand();
    release();
    owner.dispose();
    vi.unstubAllGlobals();
  }
});
