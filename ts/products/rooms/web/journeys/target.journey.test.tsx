// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { product } from "@pe/rooms-contract/product";
import { module } from "../routes/rooms/route.ts";
import { CEILING, FLOOR, code, levels, region, zone } from "./fixtures.ts";
import {
  targetChange,
  targetPaths,
  type JourneyDoc,
  type TargetProduct,
} from "../../../../tests/e2e/mounted.test-support.tsx";

// Each file holds one plan and its own rooms, so a plan or a room of the other file cannot resolve.
const chadds = {
  view: FLOOR,
  room: 1,
  name: "Office",
  regions: [zone, region(1, { name: "Office" })],
};
const models = {
  chadds,
  again: chadds,
  snowdon: { view: CEILING, room: 3, name: "Plenum", regions: [region(3, { name: "Plenum" })] },
} satisfies Record<JourneyDoc, object>;
const rooms: TargetProduct = {
  module,
  reads: Object.values(product.readings).map(({ handle }) => handle.key),
  native: (doc) => (key, input) => {
    const model = models[doc];
    const views = levels[0]!.views.filter((view) => view.uniqueId === model.view);
    if (key === "rooms.roster")
      return {
        levels: [{ ...levels[0], views }],
        regions: [],
        trackedRegionIds: model.regions.map((row) => row.uniqueId),
      };
    if (key === "rooms.snapshot") {
      if (input.view !== model.view) throw Error(`${doc} has no view ${input.view}`);
      return { levels, regions: model.regions, unreadable: [] };
    }
    if (key === "revit.context.view-image") throw Error("No image in this fixture");
    throw Error(`Unexpected native read ${key}`);
  },
  async use(doc, j) {
    const { view, room, name } = models[doc];
    const slow = { timeout: 20000 };
    // The plan is a choice only once this document's roster has answered.
    await waitFor(
      () => expect(document.querySelector(`option[value="${view}"]`)).toBeTruthy(),
      slow,
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Plan" }), { target: { value: view } });
    fireEvent.click(await screen.findByRole("option", { name: new RegExp(`^Room ${name}`) }, slow));
    expect(await screen.findByRole("textbox", { name: `Name of ${name}` }, slow)).toBeTruthy();
    await waitFor(() => expect(j.search().get("room")).toContain(code(room)));
    expect(j.search().get("view")).toContain(view);
  },
  shows: (doc) => new RegExp(models[doc].name),
};

test.each(targetPaths)("Rooms: %s leaves the old document's plan and room behind", (path) =>
  targetChange(rooms, path),
);
