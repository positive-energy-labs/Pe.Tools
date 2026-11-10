// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";
import { local, sheetSlotData, store } from "@pe/agent-contracts/slots";
import { makeAtomRegistry } from "../../../shell/owner";
import { sheetCells } from "./index.ts";
import { SheetPane } from "./pane.tsx";

/*
 * Slice 7 Delete, the census's slot features (route/slots/sheet/index.ts): each one small, each
 * red before its code. A route's core read feeds every binding; Work stays the only staged layer.
 */
afterEach(cleanup);
const draft = (value: unknown, by = "human") => ({ edit: { value, by } });

test("default layer: an unstaged, unread cell draws its default with its unit and limits, and the data projection keeps them", () => {
  const slot = { draft: true as const, bindings: {
    designFriction: local(z.number(), "route", { label: "Design friction", default: 0.08, unit: "in-wg/100 ft", min: 0, digits: 3 }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: { designFriction: {} }, model: [] });
  expect([cell!.value, cell!.source, cell!.label, cell!.unit, cell!.numeric]).toEqual([0.08, "default", "Design friction", "in-wg/100 ft", { min: 0, digits: 3 }]);
  expect(sheetSlotData(slot).bindings.designFriction).toEqual({ kind: "local", per: "route", label: "Design friction", default: 0.08, unit: "in-wg/100 ft", min: 0, digits: 3 });
});

test("model value from the read: a binding reads its row's model value out of the route's core read", () => {
  const slot = { draft: true as const, bindings: {
    terminalDrop: local(z.string(), "route", { model: (read: { slots: Record<string, string> }) => ({ value: read.slots.terminalDrop }) }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: {}, model: [], read: { slots: { terminalDrop: "PE_Drop" } } });
  expect([cell!.value, cell!.model, cell!.source, cell!.freshness]).toEqual(["PE_Drop", "PE_Drop", "model", "fresh"]);
});

test("choice kind with options from the read: a binding offers the read's options for its row", () => {
  const slot = { bindings: {
    fanStatic: local(z.string(), "route", { choices: (read: { esp: string[] }) => read.esp.map((p) => ({ key: p, label: p })) }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: {}, model: [], read: { esp: ["ESP", "PE_ESP"] } });
  expect(cell!.choices?.map((c) => c.key)).toEqual(["ESP", "PE_ESP"]);
});

test("rows per binding: a binding names its own rows from the read, apart from the route subject", () => {
  const slot = { draft: true as const, bindings: {
    roles: store("_PE_DuctLosses", z.object({ role: z.string() }), "subject", { rows: (read: { units: string[] }) => read.units, rowLabel: (_r, row) => `Unit ${row}` }),
    note: local(z.string(), "subject"),
  } };
  const cells = sheetCells(slot, { rows: ["fan-1"], work: { roles: { u1: draft({ role: "fan" }) } }, model: [], read: { units: ["u1", "u2"] } });
  expect(cells.map((c) => [c.binding, c.row, c.label])).toEqual([["roles", "u1", "Unit u1"], ["roles", "u2", "Unit u2"], ["note", "fan-1", "note"]]);
});

test("firm layer on source: a model value the firm file supplies draws as firm with the file it came from", () => {
  const slot = { draft: true as const, bindings: {
    velocity: local(z.number(), "route", { unit: "ft/min", model: () => ({ value: 900, source: "firm" as const, ref: "v3 · ducts.json", unit: "fpm" }) }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: { velocity: {} }, model: [], read: {} });
  // The read's own unit for the row wins over the binding's.
  expect([cell!.value, cell!.source, cell!.ref, cell!.unit]).toEqual([900, "firm", "v3 · ducts.json", "fpm"]);
  // The read may also lock a row and say why, or note a conflict beside its value.
  const locked = sheetCells({ bindings: { flow: local(z.number(), "route", { model: () => ({ value: 1, refusal: "no flow parameter", note: "Conflict: walk 900" }) }) } },
    { rows: [], work: {}, model: [], read: {} });
  expect([locked[0]!.refusal, locked[0]!.note]).toEqual(["no flow parameter", "Conflict: walk 900"]);
});

test("typed-only filter: the sheet pane's chrome narrows to the cells Work stages, and says so when none are", () => {
  const doc = { a: draft(1), b: {} };
  const handle = (path: readonly string[]) => ({
    owner: { route: "t", label: "typed" }, refusal: null, value: path[0] === "a" ? doc.a : {},
    transitions: () => [], stage: async () => null, clear: async () => null,
  });
  const ctx = { cells: { doc, at: handle }, page: { read: () => ({}) }, value: { status: "ready", current: true, value: {} } };
  const slot = { draft: true as const, bindings: { a: local(z.number(), "route", { label: "Alpha" }), b: local(z.number(), "route", { label: "Beta", default: 2 }) } };
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
  expect(screen.getByText("Beta")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /show typed cells only/i }));
  expect(screen.queryByText("Beta")).toBeNull();
  expect(screen.getByText("Alpha")).toBeTruthy();
});

test("empty state: a sheet whose read has nothing for it says so and where to go, instead of drawing cells", () => {
  const ctx = { cells: { doc: {}, at: () => { throw Error("no cell is drawn"); } }, page: { read: () => ({}) }, value: { status: "ready", current: true, value: { open: null } } };
  const slot = { draft: true as const, empty: (read: { open: unknown }) => (read.open ? null : "Open a fan from the roster."), bindings: { a: local(z.number()) } };
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
  expect(screen.getByText("Open a fan from the roster.")).toBeTruthy();
});
