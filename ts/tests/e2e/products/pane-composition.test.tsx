// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup,fireEvent,render,screen,within } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach,expect,test,vi } from "vite-plus/test";
import { createWitness } from "../fans-witness.test-support.ts";
import { makeAtomRegistry } from "../../../apps/web/src/shell/owner.ts";
import { systemCode } from "@pe/ducts-web/identity";
import { snapshot } from "@pe/ducts-domain/test-fixture";
import sheetFixture from "@pe/ducts-web/fixtures/fan-sheet.json";

const leaves = vi.hoisted(() => ({ tree: vi.fn(), picture: vi.fn(), inbox: vi.fn() }));
vi.mock("@pe/duct-systems-web/screen/tree-sidebar", () => ({
  SystemTree: () => {
    leaves.tree();
    return <p>Tree body</p>;
  },
}));
vi.mock("@pe/duct-systems-web/screen/picture", async (actual) => ({
  ...(await actual<typeof import("@pe/duct-systems-web/screen/picture")>()),
  DuctsPicture: () => {
    leaves.picture();
    return <p>Picture body</p>;
  },
}));
vi.mock("@pe/duct-systems-web/screen/inbox", () => ({
  Inbox: () => {
    leaves.inbox();
    return <p>Inbox body</p>;
  },
  FanButton: () => null,
}));
const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const close of closes.splice(0).reverse()) close();
  vi.clearAllMocks();
});
function nodeFor(mount: { read(pane: string): unknown }, pane: string) {
  const node = mount.read(pane);
  if (!isValidElement(node)) throw Error(`Pane ${pane} did not return a React element`);
  return node;
}
function registry() {
  const value = makeAtomRegistry();
  closes.push(() => value.dispose());
  return value;
}


test("Q2a keeps kind and colour editors on ducts and fan settings on fans", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.state === "ready").toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() => expect(f.owner.readingStatus("duct-systems").snapshot.state === "ready").toBe(true));
  await vi.waitFor(() => expect(f.fans.readingStatus("calcSnapshot").snapshot.state === "ready").toBe(true));
  const view = render(<RegistryContext value={registry()}>
    {nodeFor(f.owner, "e-systems")}{nodeFor(f.owner, "e-rules-all")}
  </RegistryContext>);
  expect(screen.queryByRole("region", { name: "System colours" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Fan inputs" })).toBeNull();
  expect(screen.getByRole("combobox", { name: "Search systems" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Duct settings" }));
  expect(await screen.findByRole("region", { name: "System colours" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Fan inputs" }).getAttribute("href")).toMatch(/^\/fans(?:\?|$)/);
  expect(screen.getAllByRole("region", { name: "Unit kinds" })).toHaveLength(1);
  expect(screen.queryByRole("region", { name: "Fan settings" })).toBeNull();
  view.unmount();
  // Fans' inputs are its own Work, drawn by the sheet slot; design friction is /ducts design data.
  render(<RegistryContext value={registry()}>{nodeFor(f.fans, "calc-inputs")}</RegistryContext>);
  expect(document.querySelectorAll('[data-sheet-cell="Design friction"]')).toHaveLength(0);
  expect(screen.queryByRole("region", { name: "System colours" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Unit kinds" })).toBeNull();
  await vi.waitFor(() => expect(document.querySelectorAll('[data-sheet-address^="roles:"]').length).toBe(
    snapshot.nodes.filter(node => node.kind === "equipment").length,
  ));
  cleanup();
  render(<RegistryContext value={registry()}>{nodeFor(f.owner, "design")}</RegistryContext>);
  expect(document.querySelectorAll('[data-sheet-cell="Design friction"]')).toHaveLength(1);
});



test("/ducts design sheet stages each criterion in /ducts Work, and Fans Work never moves", async () => {
  const f = await createWitness(closes, new Map(), {
    "fans.calc-detail": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", revision: 1, value: {
        rows: sheetFixture.roster.rows, progress: null, opened: [],
        open: { overview: sheetFixture.overview, elements: null, legs: null, worstLegs: [], calcBreakdown: null,
          inputs: sheetFixture.inputs },
      } });
    } },
    "fans.calc-detail-snapshot": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", value: { ...snapshot, systems: [] }, revision: 1 });
    } },
  });
  await vi.waitFor(() => expect(f.fans.readingStatus("ductSystemsWork").snapshot.state === "ready").toBe(true));
  await vi.waitFor(() => expect(f.fans.readingStatus("sheet").snapshot.state === "ready").toBe(true));
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  const acks: { route: string; label?: string }[] = [];
  closes.push(f.ws.subscribeUncaptured((event) => {
    if (event.ok) acks.push({ route: event.route, label: event.label });
  }));
  const ducts0 = f.owner.work()?.revision ?? 0;
  const fans0 = f.fans.work()?.revision;
  // /ducts' design sheet stages each criterion in /ducts Work (ruling 2026-11-10); Fans Work never moves.
  const view = render(<RegistryContext value={registry()}>{nodeFor(f.owner, "design")}</RegistryContext>);
  const field = await vi.waitFor(() => {
    const cell = view.container.querySelector('[data-sheet-address="criteria.terminalDropInWg"]');
    if (!cell) throw Error("Waiting for the terminal drop cell");
    return cell;
  });
  const input = field.querySelector<HTMLInputElement>("input.dl-cell-input")!;
  fireEvent.change(input, { target: { value: "0.07" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await vi.waitFor(() => expect(f.owner.work()?.revision).toBe(ducts0 + 1));
  expect(f.owner.work()?.value).toMatchObject({ criteria: { terminalDropInWg: { edit: { value: 0.07 } } } });
  view.rerender(<RegistryContext value={registry()}>{nodeFor(f.owner, "design")}</RegistryContext>);
  // A criterion choice stages its own cell the same way.
  const split = view.container.querySelector<HTMLElement>('[data-sheet-address="criteria.splitPolicy"]')!;
  fireEvent.click(split.querySelector<HTMLElement>("button")!);
  const pick = await vi.waitFor(() => {
    const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')];
    const other = options.find((o) => o.getAttribute("aria-selected") !== "true" && o.getAttribute("aria-disabled") !== "true");
    if (!other) throw Error("no other split policy");
    return other;
  });
  fireEvent.click(pick);
  await vi.waitFor(() => expect(f.owner.work()?.revision).toBe(ducts0 + 2));
  expect(f.owner.work()?.value).toMatchObject({ criteria: { splitPolicy: { edit: { value: expect.any(String) } } } });
  // Clearing the typed criterion is the cell's own clear verb; it returns to the layer underneath.
  view.rerender(<RegistryContext value={registry()}>{nodeFor(f.owner, "design")}</RegistryContext>);
  fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-sheet-address="criteria.terminalDropInWg"]')!).getByRole("button", { name: "clear" }));
  await vi.waitFor(() => expect(f.owner.work()?.revision).toBe(ducts0 + 3));
  expect((f.owner.work()?.value as { criteria?: Record<string, { edit?: unknown }> }).criteria?.terminalDropInWg?.edit ?? undefined).toBeUndefined();
  expect(f.fans.work()?.revision).toBe(fans0);
  expect(acks.filter((a) => a.route === "fans")).toEqual([]);
});
