// @vitest-environment jsdom
/**
 * The takeoffs cutover on the web: every cell family draws Pea's proposal in the band grammar
 * (accept stages, deny clears), unflag unstages, a room edit's accept carries its base, and sync
 * refuses in the host's words while a flag has only Pea's verdict.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import {
  takeoffDecisionKey,
  takeoffEditKey,
  takeoffFlagKey,
  takeoffFlagToggle,
  takeoffsRouteState,
  type TrichotomyCellLike,
} from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { CellWire } from "#/components/lang/band";
import { Table } from "#/components/master-table/table";
import { takeoffActions, takeoffSeeds } from "#/takeoff/actions";
import { withEditBases } from "#/takeoff/controller";
import { flagShape, showAdopt, TakeoffEditCell, TakeoffProposalRows } from "#/takeoff/proposals";

afterEach(cleanup);

type Cells = Record<string, TrichotomyCellLike>;
type Patch = { path: (string | number)[]; value?: unknown };

/** A family's cells behind a wire that applies each patch, as Work does. */
function useFamily(segment: string, initial: Cells) {
  const [cells, setCells] = useState(initial);
  // One log for the component's life: a redraw after a write must not lose what was written.
  const writes = useRef<Patch[][]>([]).current;
  const wire: CellWire = {
    segment,
    revision: 1,
    write: async (patches) => {
      writes.push(patches as Patch[]);
      setCells((current) => {
        const next = structuredClone(current) as Record<string, Record<string, unknown>>;
        for (const { path, value } of patches as Patch[]) {
          const [, key, rung] = path as [string, string, string];
          next[key] ??= {};
          if (value === undefined || value === null) delete next[key]![rung];
          else next[key]![rung] = value;
        }
        return next as Cells;
      });
      return null;
    },
  };
  return { cells, wire, writes };
}

let last: { cells: Cells; writes: Patch[][] };

function Family({
  segment,
  initial,
  label,
  show,
}: {
  segment: string;
  initial: Cells;
  label: (key: string) => string;
  show: (value: unknown) => string;
}) {
  const family = useFamily(segment, initial);
  last = family;
  return <TakeoffProposalRows cells={family.cells} wire={family.wire} label={label} show={show} />;
}

const accept = () =>
  act(async () => fireEvent.click(screen.getByRole("button", { name: "accept" })));
const deny = () => act(async () => fireEvent.click(screen.getByRole("button", { name: "deny" })));

const families = [
  {
    name: "adopt",
    key: "Upper Level:101",
    value: { checked: true, name: "Zone 1", systemTag: "HP-1" },
    label: () => "region 101",
    show: showAdopt,
    reads: "adopt as Zone 1 · HP-1",
  },
  {
    name: "decisions",
    key: takeoffDecisionKey("room-1", "seedless"),
    value: "dismiss",
    label: () => "flag seedless",
    show: (value: unknown) => String(value),
    reads: "dismiss",
  },
  {
    name: "reviewFlags",
    key: takeoffFlagKey("Z-1", "shape-3"),
    value: true,
    label: (key: string) => `flag shape ${flagShape(key)}`,
    show: () => "flagged for review",
    reads: "flag shape shape-3",
  },
];

for (const family of families) {
  test(`${family.name}: Pea's proposal is drawn inline; accept stages it`, async () => {
    render(
      <Family
        segment={family.name}
        initial={{ [family.key]: { proposal: { value: family.value } } }}
        label={family.label}
        show={family.show}
      />,
    );
    expect(screen.getByText(/pea proposes/)).toBeTruthy();
    expect(document.body.textContent).toContain(family.reads);
    await accept();
    expect(
      last.writes.flat().some((p) => p.path.join("|") === `${family.name}|${family.key}|staged`),
    ).toBe(true);
    expect(screen.queryByText(/pea proposes/)).toBeNull();
  });

  test(`${family.name}: deny clears Pea's proposal and stages nothing`, async () => {
    render(
      <Family
        segment={family.name}
        initial={{ [family.key]: { proposal: { value: family.value } } }}
        label={family.label}
        show={family.show}
      />,
    );
    await deny();
    expect(screen.queryByText(/pea proposes/)).toBeNull();
    expect(last.cells[family.key]?.staged).toBeUndefined();
  });
}

function Edit({ initial }: { initial: Cells }) {
  const family = useFamily("edits", initial);
  last = family;
  const key = takeoffEditKey("room-1", "people");
  return (
    <Table
      rows={[{ key: "room-1" }]}
      columns={[
        {
          key: "people",
          label: "ppl",
          cell: () => (
            <TakeoffEditCell
              roomId="room-1"
              field="people"
              value={2}
              digits={0}
              integer
              cell={family.cells[key]}
              wire={family.wire}
              onPatch={vi.fn()}
            />
          ),
        },
      ]}
      rowKey={(row) => row.key}
      label="atlas"
    />
  );
}

test("edits: an atlas cell shows Pea's proposed value with its verbs; accept stages it", async () => {
  const key = takeoffEditKey("room-1", "people");
  render(<Edit initial={{ [key]: { proposal: { value: 4 } } }} />);
  const cell = document.querySelector<HTMLElement>("[data-scale='row']")!;
  expect(cell.getAttribute("data-body")).toBe("proposed");
  expect(cell.querySelector("input")!.value).toBe("4");
  await accept();
  expect(last.cells[key]?.staged).toEqual({ value: 4 });
});

test("edits: deny clears Pea's proposed value", async () => {
  const key = takeoffEditKey("room-1", "people");
  render(<Edit initial={{ [key]: { proposal: { value: 4 } } }} />);
  await deny();
  expect(last.cells[key]?.proposal).toBeUndefined();
  expect(last.cells[key]?.staged).toBeUndefined();
});

test("edits: a stage (accept or typing) carries the room's base when it has none", () => {
  const room = { guid: "room-1", name: "Den", type: "office", ceilingFt: 9, data: null } as never;
  const stage = [
    { path: ["edits", takeoffEditKey("room-1", "people"), "staged"], value: { value: 4 } },
  ];
  const world = { zones: [{ rooms: [room] }] };
  expect(withEditBases({ bases: {} }, world, stage)[0]).toMatchObject({
    path: ["bases", "room-1"],
    value: { name: "Den" },
  });
  expect(withEditBases({ bases: { "room-1": {} } }, world, stage)).toEqual(stage);
});

test("reviewFlags: unflag unstages the shape's cell", () => {
  const doc = takeoffsRouteState.schema.parse({
    reviewFlags: { [takeoffFlagKey("Z-1", "shape-3")]: { staged: { value: true } } },
  });
  const patches = takeoffFlagToggle(doc, "Z-1", "shape-3") as Patch[];
  expect(
    patches.some(
      (p) =>
        p.path.join("|") === `reviewFlags|${takeoffFlagKey("Z-1", "shape-3")}|staged` &&
        p.value === null,
    ),
  ).toBe(true);
});

type SyncSeed = {
  target: { kind: "document"; ref: { session: string; openId: string } };
  readings: {
    snapshot: {
      capture: {
        id: string;
        snapshot: {
          world: {
            zones: { zone: { guid: string }; rooms: { guid: string; flags: string[] }[] }[];
          };
        };
      };
    };
    rhvacVersion: { path: string; fileVersion: string };
  };
};

test("sync is refused in the host's words while a flag has only Pea's verdict", () => {
  const seed = takeoffSeeds.sync as unknown as SyncSeed;
  const observation = seed.readings.snapshot;
  const zone = observation.capture.snapshot.world.zones.find((z) =>
    z.rooms.some((r) => r.flags.length),
  )!;
  const room = zone.rooms.find((r) => r.flags.length)!;
  const key = { binding: "address" as const, route: "takeoffs", target: "C:/m/projectA.rvt" };
  const doc = takeoffsRouteState.schema.parse({
    decisions: Object.fromEntries(
      room.flags.map((flag) => [
        takeoffDecisionKey(room.guid, flag),
        { proposal: { value: "dismiss" } },
      ]),
    ),
  });
  const version = seed.readings.rhvacVersion;
  const ctx = {
    target: seed.target,
    work: { key, revision: 1, doc, refusal: null },
    readings: {
      snapshot: { state: "ready", observation },
      rhvacVersion: { state: "ready", observation: version },
    },
    page: {
      r10: version.path,
      zones: [zone.zone.guid],
      syncReview: {
        target: seed.target.ref,
        work: { key, revision: 1 },
        captureId: observation.capture.id,
        fileVersion: version.fileVersion,
        path: version.path,
        zones: [zone.zone.guid],
      },
    },
  };
  expect(takeoffActions["commit-sync"].ready(ctx as never)).toBe(
    "1 selected zones are not ready to sync",
  );
});
