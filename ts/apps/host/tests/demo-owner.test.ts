import { expect, test } from "vite-plus/test";
import { createDemoOwner } from "../src/demo-owner.ts";

test("demo tenancy serves catalog examples, retires, and never simulates a native write", async () => {
  const seed = {
    route: "arbitrary-route",
    responses: {
      "revit.catalog.loaded-families": {
        families: [],
        issues: [],
        summary: {
          totalFamilies: 0,
          placedFamilies: 0,
          unplacedFamilies: 0,
          totalTypes: 0,
          totalPlacedInstances: 0,
          truncated: false,
        },
      },
    },
  };
  const owner = await createDemoOwner("unused", seed);
  const call = () =>
    new Request("http://fixture/call", {
      method: "POST",
      body: JSON.stringify({ key: "revit.catalog.loaded-families" }),
    });
  try {
    expect(await (await owner.fetch(call())).json()).toEqual(seed.responses["revit.catalog.loaded-families"]);
    expect(
      (await owner.fetch(new Request("http://fixture/actions", { method: "POST" }))).status,
    ).toBe(404);
  } finally {
    await owner.dispose();
  }
  expect((await owner.fetch(call())).status).toBe(410);
});
