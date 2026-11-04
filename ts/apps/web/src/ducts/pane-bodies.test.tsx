// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { emptyListSearch } from "@pe/agent-contracts";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach,expect,test,vi } from "vite-plus/test";
import { createWitness } from "../fans/cutover.test-support";
import type { AdmittedMount } from "../shell/admitted-mount";
import { makeAtomRegistry } from "../shell/owner";
import { cellFocusOf,cellFocusSubject } from "./cell-focus";
import { localId,localSubject } from "./neutral";
import { snapshot } from "./test-fixture";

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
function nodeFor(mount: Pick<AdmittedMount, "read">, pane: string) {
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
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.current).toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [localId("ducts-system", "SA")] });
  await vi.waitFor(() => expect(f.owner.readingStatus("ducts").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.readingStatus("sheetSnapshot").snapshot.current).toBe(true));
  const view = render(<RegistryContext value={registry()}>
    {nodeFor(f.owner, "e-systems")}{nodeFor(f.owner, "e-rules-all")}
  </RegistryContext>);
  expect(screen.getAllByRole("region", { name: "System colours" })).toHaveLength(1);
  expect(screen.getAllByRole("region", { name: "Unit kinds" })).toHaveLength(1);
  expect(screen.queryByRole("region", { name: "Fan settings" })).toBeNull();
  view.unmount();
  render(<RegistryContext value={registry()}>{nodeFor(f.fans, "sheet-inputs")}</RegistryContext>);
  expect(screen.getAllByRole("region", { name: "Fan settings" })).toHaveLength(1);
  expect(document.querySelectorAll('[data-sheet-cell="Design friction"]')).toHaveLength(1);
  expect(screen.queryByRole("region", { name: "System colours" })).toBeNull();
  expect(screen.queryByRole("region", { name: "Unit kinds" })).toBeNull();
  expect(document.querySelectorAll('[data-choice-cell^="Unit role "]').length).toBe(
    snapshot.nodes.filter(node => node.kind === "equipment").length,
  );
});

test("an admitted network pane runs no sibling body when another pane is hidden", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.current).toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [localId("ducts-system", "SA")] });
  await vi.waitFor(() => expect(f.owner.readingStatus("ducts").snapshot.current).toBe(true));
  f.owner.setPaneDemand("e-picture", false);
  render(<RegistryContext value={registry()}>{nodeFor(f.owner, "e-sidebar")}</RegistryContext>);
  expect(screen.getByText("Tree body")).toBeTruthy();
  expect(leaves.tree).toHaveBeenCalled();
  expect(leaves.picture).not.toHaveBeenCalled();
  expect(leaves.inbox).not.toHaveBeenCalled();
});

test("a pending sheet does not blank its roster sibling", async () => {
  const f = await createWitness(closes, new Map(), { "ducts.sheet": { kind: "use", open() {} } });
  await vi.waitFor(() => expect(f.fans.readingStatus("fans").snapshot.current).toBe(true));
  await vi.waitFor(() => expect(f.fans.readingStatus("sheet").snapshot.status).toBe("pending"));
  const rows = f.fans.readingStatus("fans").snapshot.value;
  expect(rows).toBeDefined();
  render(
    <RegistryContext value={registry()}>
      {nodeFor(f.fans, "sheet-roster")}
      {nodeFor(f.fans, "sheet-ledger")}
    </RegistryContext>,
  );
  expect(screen.getByRole("listbox", { name: "fans" }).textContent).toContain("MUAS-1");
  expect(screen.getByRole("status").textContent).toContain("computing");
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
  f.owner.controls.subject({ kind: "ids", ids: [localId("ducts-system", "SA")] });
  await vi.waitFor(() => {
    const state = f.owner.readingStatus("pricing").snapshot;
    if (state.status === "failed") throw Error(state.reason);
    expect(state.current).toBe(true);
  });
  const subject = cellFocusSubject(snapshot, ["SA"], { segment: "componentDrops", id: fitting.id });
  expect(f.owner.page.select([{ kind: "focus", id: localId("ducts-focus", subject) }]).kind).toBe(
    "accepted",
  );
  const selected = f.owner.page.read().selected[0];
  if (!selected) throw Error("The kernel did not retain the selection");
  expect(cellFocusOf(localSubject(selected.id))).toMatchObject({
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
