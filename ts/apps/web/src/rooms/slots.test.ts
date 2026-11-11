/**
 * Slice 10 falsifier for /rooms (routes MAP row 10, ADR 0035 rules 1, 2 and 8): the room is the
 * subject (a `region` SubjectRef over the carrier GUID), the view is route-owned query, and the
 * partition inbox is the kernel's goal pane over the route's one host read. The hand inbox list,
 * the `card:` selection codec and the `picked`/`show` fields are gone. The regions table and the
 * plan stay hand-drawn: the two red tests below name the kernel gap each waits on.
 */
import { existsSync, readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { decode, roomsData, roomsRouteState, type Mark } from "@pe/agent-contracts";
import { writesRevit } from "@pe/agent-contracts/slots";
import { titlePane } from "../shell/typed-shell.tsx";
import { DEMO_ROOMS, DEMO_VIEW } from "./demo.ts";
import { roomsGoal } from "./goal.ts";
import { module } from "./route.ts";
import { regionOf } from "./rows.ts";
import { regionSubject } from "./subject.ts";

const here = (file: string) => new URL(file, import.meta.url);
const CARRY = ["thread", "target", "work", "fixture", "open", "at", "atInstance", "compare"];
const [zone, room, , held] = DEMO_ROOMS.regions;
const core = { snapshot: DEMO_ROOMS } as never;

test("/rooms declares subject, query and goal, and no carry key", () => {
  const { spec, data } = module;
  expect(data.subject).toMatchObject({ field: "room", noun: "room", pane: "main", roster: "value" });
  expect(Object.fromEntries(Object.entries(data.fields).map(([k, f]) => [k, f.role]))).toEqual({
    view: "query",
    room: "subject",
    stage: "pose",
    layers: "pose",
    viewport: "pose",
    card: "pose",
    selected: "selection",
  });
  expect(Object.keys(data.fields).filter((key) => CARRY.includes(key))).toEqual([]);
  // The core read is the Goal, drawn by the kernel's goal pane beside the route's one hand body.
  expect(data.goal).toBe("value");
  expect(Object.fromEntries(Object.entries(spec.panes).map(([id, p]) => [id, (p as { kernel?: string }).kernel ?? "route"])))
    .toEqual({ main: "route", goal: "goal" });
  expect(titlePane(spec)).toBeNull();
});

test("a room is a region SubjectRef over its carrier GUID, in roster order with the table's labels", () => {
  const options = module.spec.subject!.options(core);
  expect(options.map((o) => o.label)).toEqual(["R1 · Fixture level", "R2 · Fixture level", "R3 · Fixture level", "R4 · Fixture level"]);
  expect(options[0]!.id).toBe(regionSubject(zone!.guid));
  expect(decode(options[1]!.id)).toEqual({ ok: true, value: { keyKind: "region", key: room!.guid } });
  expect(regionOf(options[1]!.id)).toBe(room!.guid);
  // Only a region names a room: an element's UniqueId is not the carrier, and never decodes as one.
  expect(regionOf(`UniqueId:${room!.uniqueId}`)).toBeNull();
});

test("the Goal is the partition inbox: failing and gone marks first, staged marks assumed, the answer greyed until none is left", () => {
  const mark = (kind: Mark["kind"], run: string, polygon: readonly (readonly number[])[]): Mark =>
    ({ kind, run, anchor: { view: DEMO_VIEW, level: "Fixture level", polygon: polygon as [number, number][] } });
  const work = roomsRouteState.schema.parse({
    marks: {
      staged: { edit: { value: mark("merge", "fixture-run", room!.outer) } },
      failing: { edit: { value: mark("wall", "older-run", room!.outer) } },
      gone: { edit: { value: mark("reject", "older-run", [[900, 900], [910, 900], [910, 910]]) } },
    },
  });
  const goal = roomsGoal(work, DEMO_ROOMS, DEMO_VIEW);
  expect(goal.unresolved.map((c) => [c.id, c.resolver, c.subject ?? null])).toEqual([
    ["mark:failing", "person", regionSubject(room!.guid)],
    ["mark:gone", "person", null],
  ]);
  expect(goal.unresolved[0]!.says).toMatch(/^wall R2 · failing/);
  expect(goal.assumed.map((c) => c.id)).toEqual(["mark:staged"]);
  expect(goal.next?.id).toBe("mark:failing");
  expect(goal.result).toEqual({ kind: "estimate", value: null, sources: [] });
  // Nothing left: the answer stands. No view, or a view never partitioned, names its exit.
  expect(roomsGoal(roomsRouteState.schema.parse({}), DEMO_ROOMS, DEMO_VIEW).result).toEqual({ kind: "complete", value: "2 rooms on Fixture level plan" });
  expect(roomsGoal(work, DEMO_ROOMS, "").unresolved).toEqual([{ id: "view", says: "Choose a level and a plan view", resolver: "person" }]);
  expect(roomsGoal(work, { ...DEMO_ROOMS, regions: [zone!, held!] }, DEMO_VIEW).unresolved[0]).toMatchObject({ id: "partition", resolver: { op: "rooms.partition" } });
  // The host read publishes it: the core value carries the Goal's fields, and decodes this one.
  const published = roomsData.pick({ unresolved: true, assumed: true, next: true, inputs: true, result: true });
  expect(published.safeParse(goal).success).toBe(true);
});

test("the hand inbox list, the card: selection codec and the picked/show fields are deleted", () => {
  for (const file of ["inbox.tsx", "selection.ts", "selection.test.ts"]) expect(existsSync(here(file)), file).toBe(false);
  const source = ["mount.tsx", "workspace.tsx", "bindings.ts", "route.ts", "page.ts", "card.tsx"]
    .map((file) => readFileSync(here(file), "utf8")).join("\n");
  expect(source).not.toMatch(/RoomsInbox|roomSelection|card:\$\{|raw\.picked|page\.show|onShow|ListView/);
});

/*
 * The plan names `store` bindings for the room fields. The slot can draw a `store` cell, but the
 * kernel's one write pair cannot write one: `sheet.plan`/`sheet.apply` derive writes from
 * `parameter` bindings only (`apps/host/src/slots/sheet.ts`, `sheetWrites`), with one hard-coded
 * exception for the ducts losses store, and the room fields live on the region's carrier keyed by
 * its GUID, which no store leaf addresses. A route that declares a `store` binding still earns the
 * kernel's "Write to Revit" verb (`writesRevit`), which would refuse "Nothing to write". So the
 * regions table keeps its hand cells over `rooms.write`. Green when a staged `store` cell plans a
 * write; then /rooms declares its sheet and the table goes.
 */
test.fails("kernel gap: store-binding-write (10)", async () => {
  const { sheetWrites } = await import("../../../host/src/slots/sheet.ts");
  const sheet = { draft: true as const, bindings: { name: { kind: "store" as const, store: "rooms", per: "subject" as const } } };
  expect(writesRevit(sheet)).toBe(true);
  expect(sheetWrites(sheet, { name: { [regionSubject(room!.guid)]: { edit: { value: "Pantry" } } } })).toHaveLength(1);
});

/*
 * The plan names the picture slot for the room plan. `route()` projects a declared picture into
 * route data, but no pane draws from the slot (routes ledger, slice 8 residue: a ruling on a
 * kernel-drawn picture pane is owed), its pose is the 3D scene's (orbit camera, section, context)
 * while the room plan is a registered raster of one Revit plan view under a plane camera, and a
 * mark sits on a SubjectRef, a point or a segment, never on a polygon, which is what a feedback
 * mark is. So the plan, its sketch tools and its solver layers stay one hand body. Green when the
 * kernel draws a pane from a declared picture; then /rooms declares it and the plan body goes.
 */
test.fails("kernel gap: picture-pane (10)", () => {
  expect(module.data).toHaveProperty("picture");
  expect(Object.values(module.spec.panes).map((pane) => (pane as { kernel?: string }).kernel)).toContain("picture");
});
