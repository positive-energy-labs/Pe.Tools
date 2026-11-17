import { refusalOf, valueOf } from "../../../../apps/web/src/route/typed-route.ts";
import { pricing } from "@pe/duct-systems-contract/contract";
// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach,expect,test,vi } from "vite-plus/test";
import { createWitness } from "./cutover.test-support.ts";
import { typedSubjectDoor } from "../../../../apps/web/src/shell/subject.ts";
import { SubjectDoor } from "../../../../apps/web/src/shell/subject.ts";
import { makeAtomRegistry } from "../../../../apps/web/src/shell/owner.ts";
import { cellFocusOf,cellFocusSubject } from "@pe/ducts-web/cell-focus";
import { ductsLink, systemCode } from "@pe/ducts-web/identity";
import { snapshot } from "@pe/ducts-domain/test-fixture";

const leaves = vi.hoisted(() => ({ tree: vi.fn(), picture: vi.fn(), inbox: vi.fn() }));
vi.mock("./screen/tree-sidebar.tsx", () => ({
  SystemTree: () => {
    leaves.tree();
    return <p>Tree body</p>;
  },
}));
vi.mock("./screen/picture.tsx", async (actual) => ({
  ...(await actual<typeof import("./screen/picture.tsx")>()),
  DuctsPicture: () => {
    leaves.picture();
    return <p>Picture body</p>;
  },
}));
vi.mock("./screen/inbox.tsx", () => ({
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
  const f = await createWitness(closes, new Map(), { [pricing.key]: { kind: "use", open() {} } });
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.state === "ready").toBe(true));
  expect(valueOf(f.owner.readingStatus("value").snapshot)).toBeFalsy();
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

test("an admitted network pane runs no sibling body when another pane is hidden", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.state === "ready").toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() => expect(f.owner.readingStatus("ducts").snapshot.state === "ready").toBe(true));
  f.owner.setPaneDemand("e-picture", false);
  render(<RegistryContext value={registry()}>{nodeFor(f.owner, "e-sidebar")}</RegistryContext>);
  expect(screen.getByText("Tree body")).toBeTruthy();
  expect(leaves.tree).toHaveBeenCalled();
  expect(leaves.picture).not.toHaveBeenCalled();
  expect(leaves.inbox).not.toHaveBeenCalled();
});

test("a restored semantic cell selection lands on that fitting cell through the receiving pane", async () => {
  const f = await createWitness(closes);
  const fitting = snapshot.nodes.find((node) => node.kind === "fitting");
  if (!fitting) throw Error("The pinned network has no fitting");
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.state === "ready").toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() => {
    const state = f.owner.readingStatus("value").snapshot;
    if (state.state === "refused") throw Error(refusalOf(state) ?? "Read failed");
    expect(state.state === "ready").toBe(true);
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

test("a rule owner crossing without system context still lands on its rule", async () => {
  const f = await createWitness(closes);
  const url = new URL(ductsLink([], {}, { kind: "rule", key: "tap-std" }), "http://127.0.0.1");
  const destination = f.mount(f.admitted.owner, url.searchParams, "rule-no-system");
  expect(destination.page.read().selected.map((item: { id: string }) => item.id)).toEqual(["rule:tap-std"]);
  await vi.waitFor(() => expect(destination.readingStatus("value").snapshot.state === "ready").toBe(true));
  const view = render(<RegistryContext value={registry()}>{nodeFor(destination, "e-rules-all")}</RegistryContext>);
  const row = view.container.querySelector('[data-key="tap-std"]');
  expect(row).not.toBeNull();
  expect(row?.hasAttribute("data-landed")).toBe(true);
});
