import { contract } from "@pe/agent-contracts/handle";
import { native } from "@pe/agent-contracts/handle";
import * as resources from "../../../host/resource-state";
import { ductsRouteState } from "@pe/duct-systems-contract/ducts";
import { workFingerprintSchema, type WorkJournalDoor } from "@pe/agent-contracts";
import { ductsSettings } from "@pe/ducts-contract/settings";

import { hostRead } from "../../host-read.ts";
import { read, route, scrollBody } from "../../defaults.ts";
import { mountTypedRoute } from "../../../shell/typed-mount.ts";
import { createFixtureWorkDoor } from "../../../shell/fixture-work-door.ts";
import { module as settingsModule, settingsSheet } from "../../../settings/route.ts";
import { settingLayer } from "@pe/agent-contracts/setting-owners";
// @vitest-environment jsdom
import { useState } from "react";
import { RegistryContext } from "@effect/atom-react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { z } from "zod";
import { local, setting, sheetSlotData, store } from "@pe/agent-contracts/slots";
import { makeAtomRegistry } from "../../../shell/owner";
import { homeHandle, sheetCells } from "./index.ts";
import { SheetPane } from "./pane.tsx";

/*
 * Slice 7 Delete, the census's slot features (route/slots/sheet/index.ts): each one small, each
 * red before its code. A route's core read feeds every binding; Work stays the only staged layer.
 */
afterEach(cleanup);
const draft = (value: unknown, by = "human") => ({ edit: { value, by } });

test("default layer: an unstaged, unread cell draws its default with its unit and limits, and the data projection keeps them", () => {
  const slot = { draft: true as const, bindings: {
    localRate: local({ kind: "number", unit: "in-wg/100 ft", min: 0, digits: 3 }, "route", { label: "Design friction", default: 0.08 }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: { localRate: {} } });
  expect([cell!.value, cell!.source, cell!.label, cell!.unit, cell!.numeric]).toEqual([0.08, "default", "Design friction", "in-wg/100 ft", { min: 0, digits: 3 }]);
  expect(sheetSlotData(slot).bindings.localRate).toEqual({ home: { at: "local" }, domain: { kind: "number", unit: "in-wg/100 ft", min: 0, digits: 3 }, per: "route", label: "Design friction", default: 0.08 });
});

test("model value from the read: a binding reads its row's model value out of the route's core read", () => {
  const slot = { draft: true as const, bindings: {
    terminalDrop: local({ kind: "enum", shape: z.string(), choices: [] }, "route", { model: (read: { slots: Record<string, string> }) => ({ value: read.slots.terminalDrop }) }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: {}, read: { slots: { terminalDrop: "PE_Drop" } } });
  expect([cell!.value, cell!.model, cell!.source, cell!.freshness]).toEqual(["PE_Drop", "PE_Drop", "model", "fresh"]);
});

test("choice kind with options from the read: a binding offers the read's options for its row", () => {
  const slot = { bindings: {
    requiredEsp: local({ kind: "enum", shape: z.string(), choices: (read: { esp: string[] }) => read.esp.map((p) => ({ value: p, label: p })) }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: {}, read: { esp: ["ESP", "PE_ESP"] } });
  expect(cell!.choices?.map((c) => c.key)).toEqual(["ESP", "PE_ESP"]);
});

test("rows per binding: a binding names its own rows from the read, apart from the route subject", () => {
  const slot = { draft: true as const, bindings: {
    roles: store("_PE_DuctLosses", { kind: "object", fields: { role: { kind: "enum", shape: z.string(), choices: [] } } }, "subject", { rows: (read: { units: string[] }) => read.units, rowLabel: (_r, row) => `Unit ${row}` }),
    note: local({ kind: "enum", shape: z.string(), choices: [] }, "subject"),
  } };
  const cells = sheetCells(slot, { rows: ["fan-1"], work: { roles: { u1: draft({ role: "fan" }) } }, read: { units: ["u1", "u2"] } });
  expect(cells.map((c) => [c.binding, c.row, c.label])).toEqual([["roles", "u1", "Unit u1"], ["roles", "u2", "Unit u2"], ["note", "fan-1", "note"]]);
});

test("firm layer on source: a model value the firm file supplies draws as firm with the file it came from", () => {
  const slot = { draft: true as const, bindings: {
    velocity: local({ kind: "number", unit: "ft/min" }, "route", { model: () => ({ value: 900, source: "firm" as const, ref: "v3 · ducts.json", unit: "fpm" }) }),
  } };
  const [cell] = sheetCells(slot, { rows: [], work: { velocity: {} }, read: {} });
  // The read's own unit for the row wins over the binding's.
  expect([cell!.value, cell!.source, cell!.ref, cell!.unit]).toEqual([900, "firm", "v3 · ducts.json", "fpm"]);
  // The read may also lock a row and say why, or note a conflict beside its value.
  const locked = sheetCells({ bindings: { flow: local({ kind: "number" }, "route", { model: () => ({ value: 1, refusal: "no flow parameter", note: "Conflict: walk 900" }) }) } },
    { rows: [], work: {}, read: {} });
  expect([locked[0]!.refusal, locked[0]!.note]).toEqual(["no flow parameter", "Conflict: walk 900"]);
});

test("typed-only filter: the sheet pane's chrome narrows to the cells Work stages, and says so when none are", () => {
  const doc = { a: draft(1), b: {} };
  const handle = (path: readonly string[]) => ({
    owner: { route: "t", label: "typed" }, refusal: null, value: path[0] === "a" ? doc.a : {},
    transitions: () => [], stage: async () => null, clear: async () => null,
  });
  const ctx = { cells: { doc, at: handle }, page: { read: () => ({}) }, value: { state: "ready", value: {} } };
  const slot = { draft: true as const, bindings: { a: local({ kind: "number" }, "route", { label: "Alpha" }), b: local({ kind: "number" }, "route", { label: "Beta", default: 2 }) } };
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
  expect(screen.getByText("Beta")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /show typed cells only/i }));
  expect(screen.queryByText("Beta")).toBeNull();
  expect(screen.getByText("Alpha")).toBeTruthy();
});

test("empty state: a sheet whose read has nothing for it says so and where to go, instead of drawing cells", () => {
  const ctx = { cells: { doc: {}, at: () => { throw Error("no cell is drawn"); } }, page: { read: () => ({}) }, value: { state: "ready", value: { open: null } } };
  const slot = { draft: true as const, empty: (read: { open: unknown }) => (read.open ? null : "Open a fan from the roster."), bindings: { a: local({ kind: "number" }) } };
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
  expect(screen.getByText("Open a fan from the roster.")).toBeTruthy();
});

const action = vi.hoisted(() => vi.fn());


test.each([null, { kind: "document" as const, ref: { session: "session", openId: "open" } }])("save at submits the exact tier hash, typed value and target %j through the action door", async (target) => {
  action.mockClear();
  const refresh = vi.fn();
  action.mockResolvedValue({ state: "succeeded", result: { tier: "firm", path: "shared/Settings/ducts.json" } });
  const allowance = setting("ducts", ["criteria", "allowanceInWg", "return"], { kind: "number" }, ["firm"], { label: "Return allowance" });
  const slot = { bindings: { required: settingsSheet.bindings["setting.ducts.parameters.requiredEsp"]!, allowance: { ...allowance, model: (read: any) => settingLayer(allowance, read.settings.ducts) } } };
  const ctx = { target, cells: { doc: {} }, page: { read: () => ({}) }, refresh,
    value: { state: "ready", value: { settings: { ducts: [
      { tier: "firm", home: "shared", name: "shared", path: "shared/Settings/ducts.json", sha256: "prior", json: { parameters: { requiredEsp: "ESP" }, criteria: { allowanceInWg: { return: 0.2 } } } },
    ] } } } };
  Object.assign(ctx.cells, { at: (path: readonly string[]) => homeHandle(path, ctx.value.value, async input => {
    await action({ id: crypto.randomUUID(), key: "settings.tiers.write", target: target ?? { kind: "host" }, input }); refresh();
  }) });
  render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
  fireEvent.change(screen.getByRole("textbox", { name: "Return allowance: value to save" }), { target: { value: "0.35" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Return allowance: value to save" }), { key: "Enter" });
  await vi.waitFor(() => expect(screen.getByDisplayValue("0.35")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Save Return allowance at the firm home" }));
  await vi.waitFor(() => expect(action).toHaveBeenCalledWith({
    id: expect.any(String), key: "settings.tiers.write", target: target ?? { kind: "host" },
    input: { owner: "ducts", tier: "firm", path: ["criteria", "allowanceInWg", "return"], value: 0.35, expectedSha256: "prior" },
  }));
  expect(refresh).toHaveBeenCalledOnce();
  expect((await screen.findByRole("status")).textContent).toContain("Saved at firm");
  const esp = screen.getByRole("textbox", { name: "requiredEsp slot (empty writes nowhere): value to save" });
  expect(esp.closest("[data-source]")?.getAttribute("data-source")).toBe("firm");
  fireEvent.change(esp, { target: { value: "" } });
  fireEvent.keyDown(esp, { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Save requiredEsp slot (empty writes nowhere) at the firm home" }));
  await vi.waitFor(() => expect(action).toHaveBeenLastCalledWith(expect.objectContaining({ input: {
    owner: "ducts", tier: "firm", path: ["parameters", "requiredEsp"], value: "", expectedSha256: "prior",
  } })));
});

// Mutant: omit the re-read after a refused stale-hash save; the sheet stays at 800.
test.each(["refused", "stale"])("a %s stale-hash save re-reads the tier and draws the value now on disk", async (outcome) => {
  action.mockClear();
  const disk = { value: 800, sha256: "read-hash" };
  const read = () => ({ settings: { ducts: [{ tier: "project", home: "project", name: "project",
    path: "project/Settings/ducts.json", sha256: disk.sha256,
    json: { criteria: { velocityLimitFpm: { supply: disk.value } } } }] } });
  const slot = { bindings: { velocity: { ...settingsSheet.bindings["setting.ducts.velocitySupplyFpm"]!, label: "Supply velocity" } } };
  function Pane() {
    const [value, setValue] = useState(read);
    const ctx = { cells: { doc: {} }, page: { read: () => ({}) }, refresh: () => setValue(read()),
      value: { state: "ready", value } };
    Object.assign(ctx.cells, { at: (path: readonly string[]) => homeHandle(path, value, async input => {
      try {
        const receipt = await action({ input });
        if (receipt.state !== "succeeded") throw Error(receipt.error);
      } finally { ctx.refresh(); }
    }) });
    return <SheetPane ctx={{ draw: ctx as never, slot }} />;
  }
  render(<RegistryContext value={makeAtomRegistry()}><Pane /></RegistryContext>);
  expect(screen.getByDisplayValue("800")).toBeTruthy();
  disk.value = 820;
  disk.sha256 = "outside-write-hash";
  action.mockImplementation(async (request) => {
    expect(request.input.expectedSha256).toBe("read-hash");
    return { state: "failed", notDispatched: true, outcome: { state: outcome, reason: "project/Settings/ducts.json changed since it was read." },
      error: "project/Settings/ducts.json changed since it was read." };
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Supply velocity: value to save" }), { target: { value: "830" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Supply velocity: value to save" }), { key: "Enter" });
  await vi.waitFor(() => expect(screen.getByDisplayValue("830")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Save Supply velocity at the project home" }));
  expect((await screen.findByRole("status")).textContent).toContain("changed since it was read");
  expect(await screen.findByText(/saved 820/)).toBeTruthy();
  expect(screen.getByDisplayValue("830")).toBeTruthy();
  expect(screen.queryByDisplayValue("800")).toBeNull();
  expect(disk.value).toBe(820);
});

test.each(["ready", "stale"] as const)("the real mount sends a setting-home save with its exact tier, target and read hash without owning Work: %s", async state => {
  const loaded = read(hostRead(contract("bindings.settings", { input: z.object({}), data: z.unknown(), uses: [] })));
  const declaration = route({ key: "settings", name: "Settings", needs: "host", host: "./host.ts", directory: settingsModule.spec.directory, fields: {}, core: loaded,
    panes: { sheet: { title: "Sheet", purpose: "Edit settings", body: "scroll", kernel: "sheet", read: loaded, draw: () => scrollBody(null) } },
    sheet: { bindings: { velocity: ductsSettings["setting.ducts.velocitySupplyFpm"]! } },
    layout: { kind: "pane", id: "sheet" } });
  const base = createFixtureWorkDoor(ductsRouteState, {});
  const sent: unknown[] = [];
  const work: WorkJournalDoor = { ...base, submit(command) {
    sent.push(command);
    return { ...base.submit(command), accepted: { subscribe(deliver, end) {
      deliver({ kind: "accepted-native", outcome: "committed", receiptId: command.id });
      end(); return () => {};
    } } };
  } };
  const data = { settings: { ducts: [{ tier: "project", home: "project", name: "project", path: "project/Settings/ducts.json", sha256: "read-hash", json: {} }] } };
  const target = { kind: "document" as const, ref: { session: "session", openId: "open" } };
  const mount = mountTypedRoute(declaration, { target, fixture: null, work: { address: null, open: target.ref },
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    custody: { current: () => true }, memory: () => ({}) }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),
    { work, sources: { "bindings.settings": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", revision: 1, fresh: state === "ready", value: { key: "settings", generation: 1, version: 1, state: state === "ready" ? "current" : "refresh-needed",
        value: { data, evaluation: "e", inputs: "i", works: [], trace: [], coverage: { requested: [], covered: [], unknown: [], refused: [] }, origin: null, freshness: "current" } } });
      return () => {};
    } } } });
  const stop = mount.subscribe(() => {});
  try {
    const result = await mount.draw("sheet", ctx => ctx.cells.at(["setting", "ducts", "project", "criteria", "velocityLimitFpm", "supply"]).stage(850));
    if (state === "stale") {
      expect(result).toMatchObject({ code: "refused" });
      expect(sent).toEqual([]);
    } else {
    expect(result).toBeNull();
    expect(sent).toEqual([expect.objectContaining({ key: "settings.tiers.write", target,
      input: { owner: "ducts", tier: "project", path: ["criteria", "velocityLimitFpm", "supply"], value: 850, expectedSha256: "read-hash" } })]);
    }
    expect(mount.work()).toBeNull();
  } finally { stop(); mount.dispose(); }
});

test("an options domain uses its native handle and retains an unavailable stored name beside the live list", async () => {
  const body = { descriptor: { key: "parameter-identities", mode: "Suggestion" as const, allowsCustomValue: true, dependsOn: [], requiredRuntimeMode: "LiveDocument" as const },
    items: [{ value: "fixture-id", label: "Fixture flow" }], result: { kind: "Success" as const, message: "" } };
  const reading = vi.spyOn(resources, "useFieldOptionsReading").mockReturnValue({ state: "ready", observation: body, changed: false });
  const stage = vi.fn(async () => null);
  const ctx = { target: { kind: "document", ref: { session: "session", openId: "open" } }, cells: { doc: {}, at: () => ({
    owner: { route: "test", label: "Work" }, value: {}, refusal: null, stage, clear: async () => null, transitions: () => [],
  }) }, page: { read: () => ({}) }, value: { state: "ready", value: {} } };
  const slot = { bindings: { slot: local({ kind: "options", handle: native("revit.catalog.field-options"),
    input: { key: "parameter-identities" }, persist: "label", mode: "suggestion" }, "route", { label: "Slot", default: "Missing flow" }) } };
  try {
    render(<RegistryContext value={makeAtomRegistry()}><SheetPane ctx={{ draw: ctx as never, slot }} /></RegistryContext>);
    expect(reading).toHaveBeenCalledWith(ctx.target.ref, "parameter-identities", {});
    fireEvent.click(screen.getByRole("button", { name: "Slot options" }));
    expect(await screen.findByText("Fixture flow")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Missing flow (unavailable)" }).getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("option", { name: /Fixture flow/ }));
    await vi.waitFor(() => expect(stage).toHaveBeenCalledWith("Fixture flow", undefined));
  } finally { reading.mockRestore(); }
});
