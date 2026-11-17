import { refusalOf, valueOf } from "../../../../apps/web/src/route/typed-route.ts";
import { pricing } from "@pe/duct-systems-contract/contract";
import { elementSubject } from "@pe/ducts-domain/work-subject";
// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { emptyListSearch } from "@pe/agent-contracts";
import { cleanup,fireEvent,render,screen,within } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach,expect,test,vi } from "vite-plus/test";
import { createWitness } from "./cutover.test-support.ts";
import { typedSubjectDoor } from "../../../../apps/web/src/shell/subject.ts";
import { SubjectDoor } from "../../../../apps/web/src/shell/subject.ts";
import { makeAtomRegistry } from "../../../../apps/web/src/shell/owner.ts";
import { cellFocusOf,cellFocusSubject } from "@pe/ducts-web/cell-focus";
import { ductsLink, systemCode } from "@pe/ducts-web/identity";
import { snapshot } from "@pe/ducts-domain/test-fixture";
import sheetFixture from "@pe/ducts-web/fixtures/fan-sheet.json";

const leaves = vi.hoisted(() => ({ tree: vi.fn(), picture: vi.fn(), inbox: vi.fn() }));



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


test("F6 the real Inputs pane renders an acknowledged role edit as a choice label", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("sheetSnapshot").snapshot.state === "ready").toBe(true));
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

test("the fan roster restores its Page query after its body is hidden and shown", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.fans.readingStatus("fans").snapshot.state === "ready").toBe(true));
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


test("no open fan is absence and every sheet pane renders without a native decode error", async () => {
  const f = await createWitness(closes, new Map(), {
    "ducts.sheet-snapshot": { kind: "use", open(_ctx, deliver) {
      deliver({ kind: "complete", value: { kind: "absent" }, revision: 0 });
    } },
  });
  for (const pane of ["sheet-roster", "sheet-inputs", "sheet-picture", "sheet-ledger"]) {
    f.fans.setPaneDemand(pane, true);
    await vi.waitFor(() => expect(f.fans.readingStatus("sheetSnapshot").snapshot.state === "ready").toBe(true));
    const view = render(<RegistryContext value={registry()}>{nodeFor(f.fans, pane)}</RegistryContext>);
    if (pane === "sheet-roster") expect(view.container.textContent).toContain("FC-23");
    // The picture pane is the kernel's, loaded lazily: its empty state arrives after the first paint.
    else expect(await screen.findByText("Open a fan from the roster.")).toBeTruthy();
    expect(view.container.textContent).not.toContain("readAt");
    view.unmount();
  }
});
