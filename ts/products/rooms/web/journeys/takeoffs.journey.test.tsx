// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { BridgeError } from "@pe/host-internal/bridge";
import { AdoptionBody } from "../src/takeoffs.tsx";
import { captures } from "../routes/takeoffs/route.ts";
import { CEILING, FLOOR, GONE, levels, reading, journey } from "./fixtures.ts";
import { Pane, type Native } from "../../../../tests/e2e/mounted.test-support.tsx";

/** One designer region on each of two plans of one name; the shared parameters are not bound yet. */
function model() {
  const state = {
    unreadable: [] as { elementId: number | null; parameter: string; reason: string }[],
  };
  const native: Native = (key, input) => {
    if (key === "rooms.roster") return { levels, regions: [] };
    if (
      key === "takeoffs.snapshot" &&
      input.views.some((view: string) => view !== FLOOR && view !== CEILING)
    )
      throw new BridgeError("That view is not in this document.", 400, {
        dispatched: true,
        issues: [
          {
            instancePath: "$.view",
            code: "RoomsViewMissing",
            message: "Plan missing",
            severity: "error",
          },
        ],
      });
    if (key === "takeoffs.snapshot")
      return {
        reading,
        snapshot: {
          status: {
            systems: [],
          },
          unreadable: state.unreadable,
          zoneFrs: [],
          regionsByZone: {},
        },
      };
    if (key === "takeoffs.candidates")
      return {
        regions: [
          {
            elementId: input.view === FLOOR ? 21 : 22,
            uniqueId: `office-zone-000000${input.view === FLOOR ? 15 : 16}`,
            typeName: "Office zone",
            view: "L2",
            viewUniqueId: input.view,
            color: "10,20,30",
            sqft: 100,
            blob: "",
            loops: [
              [
                [0, 0],
                [10, 0],
                [10, 10],
                [0, 10],
              ],
            ],
          },
        ],
      };
    if (key.startsWith("command:")) return {};
    throw Error(`Unexpected native read ${key}`);
  };
  return { state, native };
}
const Screen = ({ mount }: { mount: Parameters<typeof Pane>[0]["mount"] }) => (
  <Pane mount={mount} pane="adoption">
    {(ctx) => <AdoptionBody ctx={ctx} />}
  </Pane>
);
const keys = (j: { actions: { key: string }[] }) => j.actions.map((row) => row.key);

test("Takeoffs: choose a plan by its UniqueId, stage the choice in Work, adopt, then open the saved capture", async () => {
  const { native } = model();
  const j = await journey("takeoffs", native);
  try {
    render(<Screen mount={j.mount} />);
    await j.ready();
    // No plan chosen: nothing to adopt,.
    expect(await screen.findByText("No regions on the chosen plans")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "plan adopt" }).getAttribute("aria-description"),
    ).toBe("Select regions to adopt");
    // Two plans named L2: the ceiling plan is chosen, and only its UniqueId reaches the model.
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Snowdon level · L2 · CeilingPlan" }),
    );
    await j.ready();
    const tick = await screen.findByRole("checkbox", { name: "Select Office zone in L2" });
    expect(j.search().get("views")).toContain(CEILING);
    expect(j.nativeCalls).toContainEqual({ key: "takeoffs.candidates", input: { view: CEILING } });
    expect(j.nativeCalls).toContainEqual({
      key: "takeoffs.snapshot",
      input: { views: [CEILING], zoneUniqueIds: [] },
    });
    expect(j.nativeCalls.some((call) => JSON.stringify(call.input).includes(FLOOR))).toBe(false);
    // The choice is a cell in the Takeoffs Work, keyed by the plan's UniqueId and the region.
    const cell = `${CEILING}:22`;
    fireEvent.click(tick);
    await waitFor(() => expect(j.mount.owner()?.doc.adopt[cell]?.edit?.value.checked).toBe(true));
    await j.ready();
    const name = await screen.findByRole("textbox", { name: "Name of Office zone" });
    fireEvent.change(name, { target: { value: "West office" } });
    fireEvent.blur(name);
    await waitFor(() =>
      expect(j.mount.owner()?.doc.adopt[cell]?.edit?.value.name).toBe("West office"),
    );
    await j.ready();
    // Adopt: the sealed command reads its request from Work, the plan named by UniqueId.
    fireEvent.click(screen.getByRole("button", { name: "plan adopt" }));
    const apply = await screen.findByRole("button", { name: "adopt" });
    expect(keys(j)).toEqual(["takeoffs.adopt.preview"]);
    fireEvent.click(apply);
    await waitFor(() => expect(keys(j)).toContain("takeoffs.adopt"), { timeout: 20000 });
    expect(keys(j)).toEqual(["takeoffs.adopt.preview", "takeoffs.adopt"]);
    expect(j.mount.owner()?.doc.writeIntent["takeoffs.adopt"].edit.value).toEqual({
      views: [
        {
          view: CEILING,
          items: [
            { elementId: 22, uniqueId: "office-zone-00000016", name: "West office", systemTag: "" },
          ],
        },
      ],
    });
    // Every read of chosen plans was kept by the host: the saved capture opens without the model.
    await j.ready();
    await waitFor(
      () =>
        expect(
          screen.getByRole("combobox", { name: "Saved capture" }).querySelectorAll("option").length,
        ).toBeGreaterThan(1),
      { timeout: 20000 },
    );
    const saved = screen.getByRole("combobox", { name: "Saved capture" }) as HTMLSelectElement;
    const id = (saved.querySelectorAll("option")[1] as HTMLOptionElement).value;
    fireEvent.change(saved, { target: { value: id } });
    await waitFor(
      () => {
        const value = j.mount.value(captures);
        expect("value" in value && value.value?.saved?.id).toBe(id);
      },
      { timeout: 20000 },
    );
    expect(await screen.findByRole("listbox", { name: "Saved takeoff zones" })).toBeTruthy();
  } finally {
    await j.close();
  }
});

test("Takeoffs: a record the build cannot read is named beside the rows", async () => {
  const { native, state } = model();
  state.unreadable = [
    { elementId: null, parameter: "rooms-regions", reason: "Rooms data needs a regions map" },
  ];
  const j = await journey(
    "takeoffs",
    native,
    new URLSearchParams({ views: JSON.stringify([FLOOR]) }),
  );
  try {
    render(<Screen mount={j.mount} />);
    await j.ready();
    expect(await screen.findByText(/rooms-regions: Rooms data needs a regions map/)).toBeTruthy();
    expect(await screen.findByRole("checkbox", { name: "Select Office zone in L2" })).toBeTruthy();
  } finally {
    await j.close();
  }
});

test.each([GONE, "Old saved plan name", "123"])(
  "Takeoffs: drops gone selection %s and keeps the live plan",
  async (gone) => {
    const { native } = model();
    const j = await journey(
      "takeoffs",
      native,
      new URLSearchParams({ views: JSON.stringify([gone, FLOOR]) }),
    );
    try {
      render(<Screen mount={j.mount} />);
      await j.ready();
      expect(
        await screen.findByRole("checkbox", { name: "Select Office zone in L2" }),
      ).toBeTruthy();
      expect(JSON.parse(j.search().get("views")!)).toEqual([FLOOR]);
      expect(screen.queryByText(/Missing plan:/)).toBeNull();
      expect(j.nativeCalls.some(({ input }) => JSON.stringify(input).includes(gone))).toBe(false);
      expect(screen.getByRole("checkbox", { name: "Select Office zone in L2" })).toHaveProperty(
        "disabled",
        false,
      );
    } finally {
      await j.close();
    }
  },
);

test("Takeoffs: a malformed views field is removed from the address", async () => {
  const { native } = model();
  const j = await journey(
    "takeoffs",
    native,
    new URLSearchParams({ views: JSON.stringify("not-a-list") }),
  );
  try {
    await waitFor(() => expect(j.search().has("views")).toBe(false));
    expect(j.mount.page.read().views).toEqual([]);
  } finally {
    await j.close();
  }
});
