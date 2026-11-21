// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { product } from "@pe/rooms-contract/product";
import { module } from "../routes/rooms/route.ts";
import { module as takeoffs } from "../routes/takeoffs/route.ts";
import { CEILING, FLOOR, code, levels, reading, region, zone } from "./fixtures.ts";
import {
  backRestores,
  hostedRouteAddress,
  pin,
  targetJourney,
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
    if (key === "takeoffs.snapshot" && input.views.length === 0)
      return {
        reading,
        snapshot: { status: { systems: [] }, unreadable: [], zoneFrs: [], regionsByZone: {} },
      };
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
test("Rooms: Back restores the plan and room its entry names, and Forward the other document's", () =>
  backRestores(rooms));

test("Rooms: a hosted Work key cannot become a room subject", () => {
  const address = hostedRouteAddress(module, {
    thread: "caller",
    work: "workspace",
    visible: true,
  });
  expect(address.read().has("room")).toBe(false);
  expect(address.read().get("work")).toBe("workspace");
});

test("Rooms: a direct Snowdon pin drops the foreign plan and room", async () => {
  const j = await targetJourney(module, rooms.reads, rooms.native, {
    open: ["chadds", "snowdon"],
    search: new URLSearchParams({
      target: pin("snowdon"),
      view: JSON.stringify(FLOOR),
      room: JSON.stringify({ kind: "ids", ids: [code(1)] }),
    }),
  });
  try {
    const live = await j.bound("snowdon", false);
    expect(j.search().has("view")).toBe(false);
    expect(j.search().has("room")).toBe(false);
    expect(live.page.read()).toMatchObject({ view: "", room: { kind: "ids", ids: [] } });
    expect(
      j.hosts.snowdon.nativeCalls.some(({ input }) => JSON.stringify(input).includes(FLOOR)),
    ).toBe(false);
  } finally {
    await j.close();
  }
});

test("Takeoffs: a direct Chadds pin cannot restore views from Snowdon", async () => {
  const j = await targetJourney(takeoffs, rooms.reads, rooms.native, {
    open: ["chadds", "snowdon"],
    search: new URLSearchParams({ target: pin("chadds") }),
    remembered: new URLSearchParams({ target: pin("snowdon"), views: JSON.stringify([CEILING]) }),
  });
  try {
    const live = await j.bound("chadds", false);
    expect(j.search().has("views")).toBe(false);
    expect(live.page.read()).toMatchObject({ views: [] });
    expect(
      await screen.findByText("No regions on the chosen plans", {}, { timeout: 20000 }),
    ).toBeTruthy();
    expect(screen.queryByText(/Missing plan:/)).toBeNull();
  } finally {
    await j.close();
  }
});

test("Rooms: an unpinned URL uses the reopened sole document instead of a remembered closed pin", async () => {
  const j = await targetJourney(module, rooms.reads, rooms.native, {
    open: ["again"],
    search: new URLSearchParams({ view: JSON.stringify(FLOOR) }),
    remembered: new URLSearchParams({ target: pin("chadds"), view: JSON.stringify(FLOOR) }),
  });
  try {
    const live = await j.bound("again", false);
    expect(j.search().has("target")).toBe(false);
    expect(live.page.read()).toMatchObject({ view: FLOOR });
  } finally {
    await j.close();
  }
});
