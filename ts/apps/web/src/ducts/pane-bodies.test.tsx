import { elementSubject } from "@pe/ducts-domain/work-subject";
// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { emptyListSearch } from "@pe/agent-contracts";
import { cleanup,fireEvent,render,screen,within } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach,expect,test,vi } from "vite-plus/test";
import { createWitness } from "../fans/cutover.test-support";
import { typedSubjectDoor } from "../shell/subject";
import { SubjectDoor } from "../shell/subject";
import { makeAtomRegistry } from "../shell/owner";
import { cellFocusOf,cellFocusSubject } from "./cell-focus";
import { ductsLink, systemCode } from "./identity";
import { snapshot } from "./test-fixture";
import sheetFixture from "./sheet/sheet.fixture.json";

const leaves = vi.hoisted(() => ({ tree: vi.fn(), picture: vi.fn(), inbox: vi.fn() }));
vi.mock("./proto/e/tree-sidebar", () => ({
  SystemTree: () => {
    leaves.tree();
    return <p>Tree body</p>;
  },
}));
vi.mock("./proto/e/picture", () => ({
  DuctsPicture: () => {
    leaves.picture();
    return <p>Picture body</p>;
  },
}));
vi.mock("./proto/e/inbox", () => ({
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

test("F16 the sidebar navigates the document roster before pricing and keeps atomic all/clear", async () => {
  const f = await createWitness(closes, new Map(), { "ducts.pricing.value": { kind: "use", open() {} } });
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.current).toBe(true));
  expect(f.owner.readingStatus("value").snapshot.value).toBeFalsy();
  render(<RegistryContext value={registry()}>
    <SubjectDoor value={typedSubjectDoor(f.owner.native)}>
      {nodeFor(f.owner, "e-systems")}
    </SubjectDoor>
  </RegistryContext>);
  expect(screen.getByRole("listbox", { name: "systems" }).textContent).toContain("SA");
  expect(screen.getByRole("combobox", { name: "Search systems" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All systems" }));
  expect(f.owner.page.read().system).toEqual({ kind: "all" });
  fireEvent.click(screen.getByRole("button", { name: "Clear systems" }));
  expect(f.owner.page.read().system).toEqual({ kind: "ids", ids: [] });
});

test("Q2a keeps kind and colour editors on ducts and fan settings on fans", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.current).toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() => expect(f.owner.readingStatus("ducts").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.readingStatus("sheetSnapshot").snapshot.current).toBe(true));
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
  render(<RegistryContext value={registry()}>{nodeFor(f.fans, "sheet-inputs")}</RegistryContext>);
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

test("F6 the real Inputs pane renders an acknowledged role edit as a choice label", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("sheetSnapshot").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  const unit = snapshot.nodes.find((node) => node.kind === "equipment")!;
  const id = elementSubject(unit);
  f.fans.invoke("edit", { patches: [{ path: ["roles", id], value: { edit: { value: { role: "fan" } } } }] }, f.fans.workBasis()!);
  await vi.waitFor(() => expect(f.fans.work()?.value).toMatchObject({ roles: { [id]: { edit: { value: { role: "fan" } } } } }));
  const view = render(<RegistryContext value={registry()}>{nodeFor(f.fans, "sheet-inputs")}</RegistryContext>);
  const roles = await vi.waitFor(() => {
    const roles = [...view.container.querySelectorAll('[data-sheet-address^="roles:"]')];
    expect(roles.length).toBeGreaterThan(0);
    return roles;
  });
  expect(roles.some((role) => role.textContent?.includes("Fan"))).toBe(true);
  expect(roles.every((role) => !role.textContent?.includes('{"role"'))).toBe(true);
});

test("/ducts design sheet stages each criterion in /ducts Work, and Fans Work never moves", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.current).toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() => expect(f.owner.readingStatus("ducts").snapshot.current).toBe(true));
  f.owner.setPaneDemand("e-picture", false);
  render(<RegistryContext value={registry()}>{nodeFor(f.owner, "e-sidebar")}</RegistryContext>);
  expect(screen.getByText("Tree body")).toBeTruthy();
  expect(leaves.tree).toHaveBeenCalled();
  expect(leaves.picture).not.toHaveBeenCalled();
  expect(leaves.inbox).not.toHaveBeenCalled();
});

test("the fan roster restores its Page query after its body is hidden and shown", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("fans").snapshot.current).toBe(true));
  f.fans.controls.query("rosterSearch", { ...emptyListSearch(), keywords: "FC" });
  const store = registry();
  const view = render(
    <RegistryContext value={store}>{nodeFor(f.fans, "sheet-roster")}</RegistryContext>,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Search fans" }), {
    target: { value: "FC-23" },
  });
  await vi.waitFor(() => expect(f.fans.page.read().rosterSearch.keywords).toBe("FC-23"));
  f.fans.setPaneDemand("sheet-roster", false);
  view.rerender(<RegistryContext value={store}>{null}</RegistryContext>);
  f.fans.setPaneDemand("sheet-roster", true);
  view.rerender(<RegistryContext value={store}>{nodeFor(f.fans, "sheet-roster")}</RegistryContext>);
  expect(screen.getByRole("combobox", { name: "Search fans" })).toHaveProperty("value", "FC-23");
});

test("a restored semantic cell selection lands on that fitting cell through the receiving pane", async () => {
  const f = await createWitness(closes);
  const fitting = snapshot.nodes.find((node) => node.kind === "fitting");
  if (!fitting) throw Error("The pinned network has no fitting");
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.current).toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() => {
    const state = f.owner.readingStatus("value").snapshot;
    if (state.status === "failed") throw Error(state.reason ?? "Read failed");
    expect(state.current).toBe(true);
  });
  const subject = cellFocusSubject(snapshot, ["SA"], { segment: "componentDrops", id: fitting.id });
  expect(f.owner.page.select([{ kind: "focus", id: subject }]).kind).toBe(
    "accepted",
  );
  const selected = f.owner.page.read().selected[0];
  if (!selected) throw Error("The kernel did not retain the selection");
  expect(cellFocusOf(selected.id)).toMatchObject({
    segment: "componentDrops",
    id: fitting.id,
    pane: "this",
  });
  render(<RegistryContext value={registry()}>{nodeFor(f.owner, "e-rules")}</RegistryContext>);
  // fan cells are read-only on /ducts (U2r lock; Q2a writers move with their cells); landing focuses the cell root
  expect(document.activeElement?.tagName).toBe("SPAN");
  expect(document.activeElement).toHaveProperty("tabIndex", -1);
  expect(document.activeElement?.closest("[data-e-cell]")?.getAttribute("data-e-cell")).toBe(
    `componentDrops:${fitting.id}`,
  );
});


test("no open fan is absence and every sheet pane renders without a native decode error", async () => {
  const f = await createWitness(closes, new Map(), {
    "ducts.sheet-snapshot": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", value: { kind: "absent" }, revision: 0 });
    } },
  });
  for (const pane of ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"]) {
    f.fans.setPaneDemand(pane, true);
    await vi.waitFor(() => expect(f.fans.readingStatus("sheetSnapshot").snapshot.current).toBe(true));
    const view = render(<RegistryContext value={registry()}>{nodeFor(f.fans, pane)}</RegistryContext>);
    if (pane === "sheet-roster") expect(view.container.textContent).toContain("FC-23");
    else expect(screen.getByText("Open a fan from the roster.")).toBeTruthy();
    expect(view.container.textContent).not.toContain("readAt");
    view.unmount();
  }
});



test("/fans edits Ducts criteria and a criterion choice in place through the ducts owner handle", async () => {
  const f = await createWitness(closes, new Map(), {
    "ducts.sheet": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", revision: 1, value: {
        rows: sheetFixture.roster.rows, progress: null, opened: [],
        open: { overview: sheetFixture.overview, elements: null, legs: null, worstLegs: [], worksheet: null,
          inputs: sheetFixture.inputs },
      } });
    } },
    "ducts.sheet-snapshot": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", value: { ...snapshot, systems: [] }, revision: 1 });
    } },
  });
  await vi.waitFor(() => expect(f.fans.readingStatus("ductsWork").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.readingStatus("sheet").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  const acks: { route: string; label?: string }[] = [];
  closes.push(f.ws.subscribeUncaptured((event) => {
    if (event.ok) acks.push({ route: event.route, label: event.label });
  }));
  const ducts0 = f.owner.work()?.revision ?? 0;
  const fans0 = f.fans.work()?.revision;
  // /ducts' design sheet stages each criterion in /ducts Work (ruling 2026-11-10); Fans Work never moves.
  const view = render(<RegistryContext value={registry()}>{nodeFor(f.owner, "design")}</RegistryContext>);
  const field = await vi.waitFor(() => view.container.querySelector('[data-sheet-address="criteria:terminalDropInWg"]')!);
  const input = field.querySelector<HTMLInputElement>("input.dl-cell-input")!;
  fireEvent.change(input, { target: { value: "0.07" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  await vi.waitFor(() => expect(f.owner.work()?.revision).toBe(ducts0 + 1));
  expect(f.owner.work()?.value).toMatchObject({ criteria: { terminalDropInWg: { edit: { value: 0.07 } } } });
  view.rerender(<RegistryContext value={registry()}>{nodeFor(f.owner, "design")}</RegistryContext>);
  // A criterion choice stages its own cell the same way.
  const split = view.container.querySelector<HTMLElement>('[data-sheet-address="criteria:splitPolicy"]')!;
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
  fireEvent.click(within(view.container.querySelector<HTMLElement>('[data-sheet-address="criteria:terminalDropInWg"]')!).getByRole("button", { name: "clear" }));
  await vi.waitFor(() => expect(f.owner.work()?.revision).toBe(ducts0 + 3));
  expect((f.owner.work()?.value as { criteria?: Record<string, { edit?: unknown }> }).criteria?.terminalDropInWg?.edit ?? undefined).toBeUndefined();
  expect(f.fans.work()?.revision).toBe(fans0);
  expect(acks.filter((a) => a.route === "fans")).toEqual([]);
});

test("a rule owner crossing without system context still lands on its rule", async () => {
  const f = await createWitness(closes);
  const url = new URL(ductsLink([], {}, { kind: "rule", key: "tap-std" }), "http://127.0.0.1");
  const destination = f.mount(f.admitted.owner, url.searchParams, "rule-no-system");
  expect(destination.page.read().selected.map((item: { id: string }) => item.id)).toEqual(["rule:tap-std"]);
  await vi.waitFor(() => expect(destination.readingStatus("value").snapshot.current).toBe(true));
  const view = render(<RegistryContext value={registry()}>{nodeFor(destination, "e-rules-all")}</RegistryContext>);
  const row = view.container.querySelector('[data-key="tap-std"]');
  expect(row).not.toBeNull();
  expect(row?.hasAttribute("data-landed")).toBe(true);
});
