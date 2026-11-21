// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { BridgeError } from "@pe/host-internal/bridge";
import { RosterBody } from "../src/rooms.tsx";
import { CEILING, FLOOR, GONE, code, levels, region, zone, journey } from "./fixtures.ts";
import { Pane, Sheet, planned, type Native } from "../../../../tests/e2e/mounted.test-support.tsx";

/** A model of two plans. Each plan holds its own regions, so a wrong plan key shows at once. */
function model() {
  const regions: Record<string, ReturnType<typeof region>[]> = {
    [FLOOR]: [
      zone,
      region(1, { name: "Office", locked: true, stale: true }),
      region(2, { name: "Hall", type: "hall" }),
    ],
    [CEILING]: [region(3, { name: "Plenum" })],
  };
  const state = {
    regions,
    unreadable: [] as { elementId: number | null; parameter: string; reason: string }[],
    hold: null as Promise<void> | null,
  };
  const native: Native = async (key, input) => {
    if (key === "rooms.roster")
      return {
        levels,
        regions: [],
        trackedRegionIds: state.unreadable.length
          ? null
          : Object.values(state.regions)
              .flat()
              .map((region) => region.uniqueId),
      };
    if (key === "rooms.snapshot") {
      await state.hold;
      const regions = state.regions[input.view];
      if (!regions)
        throw new BridgeError("That view is not in this document.", 400, {
          dispatched: true,
          issues: [
            {
              instancePath: "$.view",
              code: "RoomsViewMissing",
              message: "That view is not in this document.",
              severity: "error",
            },
          ],
        });
      return { levels, regions, unreadable: state.unreadable };
    }
    if (key === "revit.context.view-image") throw Error("No image in this fixture");
    if (key.startsWith("command:")) return {};
    throw Error(`Unexpected native read ${key}`);
  };
  return { state, native };
}
const Screen = ({ mount }: { mount: Parameters<typeof Pane>[0]["mount"] }) => (
  <>
    <Pane mount={mount} pane="roster">
      {(ctx) => <RosterBody ctx={ctx} />}
    </Pane>
    <Sheet mount={mount} pane="fields" />
  </>
);
const plan = () => screen.getByRole("combobox", { name: "Plan" }) as HTMLSelectElement;
const choose = (view: string) => fireEvent.change(plan(), { target: { value: view } });
const keys = (j: { actions: { key: string }[] }) => j.actions.map((row) => row.key);

test("Rooms: choose one of two plans of one name, stage a field and submit the sheet, partition and merge commands", async () => {
  const { native } = model();
  const j = await journey("rooms", native);
  try {
    render(<Screen mount={j.mount} />);
    // Two plans named L2 are two choices: the type tells them apart and each carries its own UniqueId.
    await waitFor(() => expect(within(plan()).getAllByRole("option")).toHaveLength(3));
    expect(
      within(plan()).getByRole("option", { name: "Snowdon level · L2 · FloorPlan" }),
    ).toHaveProperty("value", FLOOR);
    expect(
      within(plan()).getByRole("option", { name: "Snowdon level · L2 · CeilingPlan" }),
    ).toHaveProperty("value", CEILING);
    // No plan chosen: the model is not read for rooms, and the partition says why it cannot run.
    expect(j.nativeCalls.some((call) => call.key === "rooms.snapshot")).toBe(false);
    expect(
      screen.getByRole("button", { name: "plan Partition" }).getAttribute("aria-description"),
    ).toBe("Choose a plan");
    choose(FLOOR);
    await j.ready();
    // The plan is in the address by its UniqueId, in one history entry.
    expect(j.search().get("view")).toContain(FLOOR);
    expect(j.writes.filter((write) => write.search.includes(FLOOR.slice(0, 8)))).toHaveLength(1);
    expect(j.nativeCalls).toContainEqual({ key: "rooms.snapshot", input: { view: FLOOR } });
    // Locked and stale are two facts of one room.
    expect((await screen.findByRole("option", { name: /^Room Office/ })).textContent).toContain(
      "locked · stale",
    );
    // No room picked: the sheet lists no cell. A picked room's fields are the sheet's cells.
    expect(screen.getByText(/open a subject to list its cells/)).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /^Room Hall/ }));
    expect(await screen.findByRole("textbox", { name: "Type of Hall" })).toHaveProperty(
      "value",
      "hall",
    );
    fireEvent.click(screen.getByRole("option", { name: /^Room Office/ }));
    // A stated field is a cell in Work, keyed by the region's UniqueId SubjectRef.
    const name = await screen.findByRole("textbox", { name: "Name of Office" });
    expect(screen.queryByRole("textbox", { name: "Type of Hall" })).toBeNull();
    fireEvent.change(name, { target: { value: "Pantry" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(j.mount.owner()?.doc.name[code(1)]?.edit?.value).toBe("Pantry"));
    await j.ready();
    // The write is the platform's sheet pair: no Rooms command of its own.
    await planned(j.mount.verb("sheet")).plan();
    expect(keys(j)).toEqual(["sheet.plan"]);
    await planned(j.mount.verb("sheet")).apply();
    await waitFor(() => expect(keys(j)).toContain("sheet.apply"));
    // Partition names this plan in Work; the sealed command reads it from there.
    await j.ready();
    fireEvent.click(screen.getByRole("button", { name: "plan Partition" }));
    await waitFor(() =>
      expect(
        keys(j),
        j.mount.verb("partition").failure ?? document.body.textContent ?? "",
      ).toContain("rooms.partition.preview"),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Partition" }));
    await waitFor(() => expect(keys(j)).toContain("rooms.partition"), { timeout: 20000 });
    expect(keys(j)).toContain("rooms.partition.preview");
    expect(j.mount.owner()?.doc.writeIntent["rooms.partition"].edit.value).toEqual({ view: FLOOR });
    // Merge takes the rooms picked on this plan, by key.
    await j.ready();
    fireEvent.click(screen.getByRole("option", { name: /^Room Office/ }));
    // A second pick adds to the first the way any list does: with Ctrl.
    fireEvent.click(await screen.findByRole("option", { name: /^Room Hall/ }), { ctrlKey: true });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "plan Merge" }).getAttribute("aria-disabled"),
      ).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "plan Merge" }));
    await waitFor(() =>
      expect(keys(j), j.mount.verb("merge").failure ?? document.body.textContent ?? "").toContain(
        "rooms.merge.preview",
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
    await waitFor(() => expect(keys(j)).toContain("rooms.merge"), { timeout: 20000 });
    expect(j.mount.owner()?.doc.writeIntent["rooms.merge"].edit.value).toEqual({
      view: FLOOR,
      regions: [code(1), code(2)],
    });
    // The other L2 is another plan: its own rooms, and the picked rooms do not follow.
    choose(CEILING);
    await j.ready();
    expect(await screen.findByRole("option", { name: /^Room Plenum/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^Room Office/ })).toBeNull();
    expect(j.nativeCalls).toContainEqual({ key: "rooms.snapshot", input: { view: CEILING } });
  } finally {
    await j.close();
  }
});

test("Rooms: a link to a plan that left the document drops it and returns to an explicit choice", async () => {
  const { native } = model();
  const j = await journey("rooms", native, new URLSearchParams({ view: JSON.stringify(GONE) }));
  try {
    render(<Screen mount={j.mount} />);
    await waitFor(() => expect(j.search().has("view")).toBe(false));
    expect(j.nativeCalls.some(({ key }) => key === "rooms.snapshot")).toBe(false);
    expect(plan()).toHaveProperty("value", "");
    // The same document still lists its plans, and choosing one recovers.
    await waitFor(() => expect(within(plan()).getAllByRole("option")).toHaveLength(3));
    choose(FLOOR);
    await j.ready();
    expect(await screen.findByRole("option", { name: /^Room Office/ })).toBeTruthy();
  } finally {
    await j.close();
  }
});

test("Rooms: a record the build cannot read is named, and an outside edit is read again", async () => {
  const { native, state } = model();
  state.unreadable = [
    { elementId: null, parameter: "rooms-regions", reason: "Rooms data needs a regions map" },
  ];
  const j = await journey("rooms", native, new URLSearchParams({ view: JSON.stringify(FLOOR) }));
  try {
    render(<Screen mount={j.mount} />);
    await j.ready();
    expect(await screen.findByText(/rooms-regions: Rooms data needs a regions map/)).toBeTruthy();
    // Another writer renames a room while this screen is open. The last rooms stay drawn while the
    // plan is read again, and editing is blocked only by Work, never by the reading.
    const release = Promise.withResolvers<void>();
    state.hold = release.promise;
    state.regions[FLOOR] = [
      zone,
      region(1, { name: "Study" }),
      region(2, { name: "Hall", type: "hall" }),
    ];
    j.reread();
    expect(await screen.findByText("Reading the plan; showing the last rooms")).toBeTruthy();
    expect(screen.getByRole("option", { name: /^Room Office/ })).toBeTruthy();
    expect(plan()).toHaveProperty("disabled", false);
    release.resolve();
    expect(
      await screen.findByRole("option", { name: /^Room Study/ }, { timeout: 20000 }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^Room Office/ })).toBeNull();
  } finally {
    await j.close();
  }
});

test("Rooms: the sheet holds every field of each picked room, and seven rooms stay seven roster rows", async () => {
  const { native, state } = model();
  state.regions[FLOOR] = [zone, ...[1, 2, 3, 4, 5, 6, 7].map((n) => region(n))];
  const j = await journey("rooms", native, new URLSearchParams({ view: JSON.stringify(FLOOR) }));
  try {
    render(<Screen mount={j.mount} />);
    await j.ready();
    // The zone is a row too: a person may state its fields and designation.
    expect(await screen.findAllByRole("option", { name: /^(Room|Zone) / })).toHaveLength(8);
    fireEvent.click(screen.getByRole("option", { name: /^Room Room 3/ }));
    fireEvent.click(screen.getByRole("option", { name: /^Zone West zone/ }), { ctrlKey: true });
    const sheet = await screen.findByRole("region", { name: "Sheet" });
    await waitFor(() => expect(sheet.querySelectorAll("[data-sheet-cell]")).toHaveLength(18));
    const labels = [...sheet.querySelectorAll("[data-sheet-cell]")].map((cell) =>
      cell.getAttribute("data-sheet-cell"),
    );
    expect(labels.filter((label) => label?.endsWith(" of Room 3"))).toEqual(
      [
        "Name",
        "Type",
        "Ceiling height",
        "People",
        "Lighting",
        "Equipment sensible",
        "Equipment latent",
        "Ventilation",
        "Role",
      ].map((field) => `${field} of Room 3`),
    );
    expect(labels).toContain("Role of West zone");
    // Each cell stands on what the region record holds until Work states otherwise.
    expect(within(sheet).getByRole("textbox", { name: "Name of Room 3" })).toHaveProperty(
      "value",
      "Room 3",
    );
  } finally {
    await j.close();
  }
});

test("Rooms: a staged field on a deleted region stays removable", async () => {
  const { native, state } = model();
  const j = await journey("rooms", native, new URLSearchParams({ view: JSON.stringify(FLOOR) }));
  try {
    render(<Screen mount={j.mount} />);
    await j.ready();
    fireEvent.click(await screen.findByRole("option", { name: /^Room Office/ }));
    const name = await screen.findByRole("textbox", { name: "Name of Office" });
    fireEvent.change(name, { target: { value: "Pantry" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(j.mount.owner()?.doc.name[code(1)]?.edit?.value).toBe("Pantry"));
    state.regions[FLOOR] = [zone, region(2, { name: "Hall" })];
    j.reread();
    expect(await screen.findByRole("option", { name: /^Room Hall/ })).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Discard Name for missing region " + region(1).uniqueId,
      }),
    );
    await waitFor(() => expect(j.mount.owner()?.doc.name[code(1)]?.edit).toBeNull());
  } finally {
    await j.close();
  }
});
