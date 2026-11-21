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
    if (key === "takeoffs.candidates") return { regions: [] };
    if (key === "takeoffs.snapshot" && input.views.every((view: string) => view === model.view))
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

test.each([
  {
    route: "Rooms",
    screenModule: module,
    from: "chadds",
    to: "snowdon",
    field: "view",
    machinePending: true,
  },
  {
    route: "Takeoffs",
    screenModule: takeoffs,
    from: "snowdon",
    to: "chadds",
    field: "views",
    machinePending: false,
  },
] as const)(
  "$route: inventory alone rebinds an unpinned Place after close and open",
  async (entry) => {
    const { route, screenModule, from, to, field, machinePending } = entry;
    const view = models[from].view;
    const selection = route === "Rooms" ? view : [view];
    const slow = { timeout: 20000 };
    const j = await targetJourney(screenModule, rooms.reads, rooms.native, {
      open: [from],
      machinePending,
      search: new URLSearchParams({ [field]: JSON.stringify(selection) }),
    });
    try {
      const first = await j.bound(from, false);
      expect(first.page.read()).toMatchObject({ [field]: selection });
      expect(j.search().has("target")).toBe(false);
      await j.openInventory([]);
      expect(await screen.findByRole("button", { name: "Choose a document" }, slow)).toBeTruthy();
      // The live inventory reports the replacement before the broader Machine census catches up.
      await j.openInventory([to]);
      const live = await j.bound(to, false);
      expect(live).not.toBe(first);
      expect(j.search().has("target")).toBe(false);
      for (const [name, declaration] of Object.entries(screenModule.spec.fields)) {
        if (!("target" in declaration)) continue;
        expect(j.search().has(name)).toBe(false);
        expect(live.page.read()).toMatchObject({ [name]: declaration.initial });
      }
    } finally {
      await j.close();
    }
  },
);

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

const roomsEntry = (doc: JourneyDoc, view?: string) =>
  new URLSearchParams({ target: pin(doc), ...(view ? { view: JSON.stringify(view) } : {}) });

function delayedSnowdonPlans() {
  let hold = Promise.withResolvers<void>();
  return {
    hold() {
      hold = Promise.withResolvers<void>();
    },
    release: () => hold.resolve(),
    native: (doc: JourneyDoc) => async (key: string, input: unknown) => {
      if (doc === "snowdon" && key === "rooms.roster") await hold.promise;
      return rooms.native(doc)(key, input);
    },
  };
}

test("NoLossWhileLoading: a direct link in the same Place holds the destination plan", async () => {
  const plans = delayedSnowdonPlans();
  const j = await targetJourney(module, rooms.reads, plans.native, {
    open: ["chadds", "snowdon"],
    search: roomsEntry("chadds", FLOOR),
  });
  try {
    await j.bound("chadds", false);
    await j.go(roomsEntry("snowdon", CEILING));
    const live = await j.mounted("snowdon");
    expect(j.search().get("view")).toBe(JSON.stringify(CEILING));
    expect(live.page.read().view).toBe("");
    plans.release();
    await j.bound("snowdon", false);
    expect(live.page.read().view).toBe(CEILING);
    await j.pick("chadds");
    const picked = await j.bound("chadds", false);
    expect(j.search().has("view")).toBe(false);
    expect(picked.page.read().view).toBe("");
  } finally {
    plans.release();
    await j.close();
  }
});

test("a saved-Address link keeps its plan when its document becomes available", async () => {
  const plans = delayedSnowdonPlans();
  const search = new URLSearchParams({
    target: "C:/Models/Snowdon.rvt",
    view: JSON.stringify(CEILING),
  });
  const j = await targetJourney(module, rooms.reads, plans.native, { open: ["chadds"], search });
  try {
    await waitFor(() => expect(j.mount()?.target()).toBeNull(), { timeout: 20000 });
    expect(j.search().get("view")).toBe(JSON.stringify(CEILING));
    await j.open(["chadds", "snowdon"]);
    const live = await j.mounted("snowdon");
    expect(j.search().get("view")).toBe(JSON.stringify(CEILING));
    expect(live.page.read().view).toBe("");
    plans.release();
    await j.bound("snowdon", false);
    expect(live.page.read().view).toBe(CEILING);
  } finally {
    plans.release();
    await j.close();
  }
});

test.each([false, true])(
  "NoForeignPlan: a cold link holds plan bytes during loading (valid=%s)",
  async (valid) => {
    const plans = delayedSnowdonPlans();
    const view = valid ? CEILING : FLOOR;
    const j = await targetJourney(module, rooms.reads, plans.native, {
      open: [],
      search: roomsEntry("snowdon", view),
    });
    try {
      await j.open(["snowdon"]);
      const live = await j.mounted("snowdon");
      expect(j.search().get("view")).toBe(JSON.stringify(view));
      expect(live.page.read().view).toBe("");
      expect(
        j.hosts.snowdon.nativeCalls.some(({ input }) => JSON.stringify(input).includes(view)),
      ).toBe(false);
      plans.release();
      await j.bound("snowdon", false);
      expect(live.page.read().view).toBe(valid ? view : "");
      expect(j.search().get("view")).toBe(valid ? JSON.stringify(view) : null);
      if (valid) {
        plans.hold();
        j.hosts.snowdon.host.documentChanged();
        await j.reload();
        const reloaded = await j.mounted("snowdon");
        expect(j.search().get("view")).toBe(JSON.stringify(view));
        expect(reloaded.page.read().view).toBe("");
        plans.release();
        await j.bound("snowdon", false);
        expect(reloaded.page.read().view).toBe(view);
      }
    } finally {
      plans.release();
      await j.close();
    }
  },
);

test("an initial sole document can appear while Machine is pending", async () => {
  const j = await targetJourney(module, rooms.reads, rooms.native, {
    open: [],
    machinePending: true,
    search: new URLSearchParams(),
  });
  try {
    await j.openInventory(["chadds"]);
    const live = await j.bound("chadds", false);
    expect(live.page.read().view).toBe("");
    expect(j.search().has("target")).toBe(false);
  } finally {
    await j.close();
  }
});

test.each(["chadds", "snowdon"] as const)(
  "tab memory on pin %s cannot supply a plan or a model focus",
  async (doc) => {
    const remembered = roomsEntry("chadds", FLOOR);
    remembered.set("contextRadiusFt", "19");
    remembered.set("selected", JSON.stringify([{ kind: "focus", id: code(1) }]));
    const j = await targetJourney(module, rooms.reads, rooms.native, {
      open: ["chadds", "snowdon"],
      search: roomsEntry(doc),
      remembered,
    });
    try {
      const live = await j.bound(doc, false);
      expect(live.page.read()).toMatchObject({
        view: "",
        selected: [],
        contextRadiusFt: doc === "chadds" ? 19 : 10,
      });
      expect(j.search().has("view")).toBe(false);
      expect(j.search().has("selected")).toBe(false);
    } finally {
      await j.close();
    }
  },
);

test("NoForeignFocus: only Snowdon's model focus reaches its Page", async () => {
  const plans = delayedSnowdonPlans();
  const selected = [code(1), code(3)].map((id) => ({ kind: "focus", id }));
  const search = roomsEntry("snowdon");
  search.set("selected", JSON.stringify(selected));
  const j = await targetJourney(module, rooms.reads, plans.native, { open: [], search });
  try {
    await j.open(["snowdon"]);
    const live = await j.mounted("snowdon");
    expect(j.search().get("selected")).toBe(JSON.stringify(selected));
    expect(live.page.read().selected).toEqual([]);
    plans.release();
    await j.bound("snowdon", false);
    expect(live.page.read().selected).toEqual([selected[1]]);
    expect(JSON.parse(j.search().get("selected")!)).toEqual([selected[1]]);
  } finally {
    plans.release();
    await j.close();
  }
});

test.each([
  { direction: "back", commit: false },
  { direction: "forward", commit: false },
  { direction: "back", commit: true },
  { direction: "forward", commit: true },
] as const)(
  "$direction restores its entry after two traversals (intermediate mount=$commit)",
  async ({ direction, commit }) => {
    const destinations = [roomsEntry("snowdon"), roomsEntry("snowdon", CEILING)];
    const j = await targetJourney(module, rooms.reads, rooms.native, {
      open: ["chadds", "snowdon"],
      search: roomsEntry("chadds", FLOOR),
      ...(direction === "back" ? { before: destinations.reverse() } : { after: destinations }),
    });
    try {
      await j.bound("chadds", false);
      if (commit) {
        await j[direction]();
        await j.bound("snowdon", false);
        await j[direction]();
      } else await j.traverseTwice(direction);
      const live = await j.bound("snowdon", false);
      expect(j.search().get("view")).toBe(JSON.stringify(CEILING));
      expect(live.page.read().view).toBe(CEILING);
    } finally {
      await j.close();
    }
  },
);
