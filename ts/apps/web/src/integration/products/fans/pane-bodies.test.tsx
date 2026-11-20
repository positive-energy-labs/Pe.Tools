import { elementSubject } from "@pe/ducts-domain/work-subject";
// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { emptyListSearch } from "@pe/agent-contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createWitness } from "../../../../tests/integration/products/fans/cutover.test-support.ts";
import { makeAtomRegistry } from "../../../shell/owner.ts";
import { snapshot } from "@pe/ducts-domain/test-fixture";

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
  await vi.waitFor(() =>
    expect(f.fans.readingStatus("calcSnapshot").snapshot.state === "ready").toBe(true),
  );
  await vi.waitFor(() => expect(f.fans.workBasis()).toBeTruthy());
  const unit = snapshot.nodes.find((node) => node.kind === "equipment")!;
  const id = elementSubject(unit);
  f.fans.invoke(
    "edit",
    { patches: [{ path: ["roles", id], value: { edit: { value: { role: "fan" } } } }] },
    f.fans.workBasis()!,
  );
  await vi.waitFor(() =>
    expect(f.fans.work()?.value).toMatchObject({
      roles: { [id]: { edit: { value: { role: "fan" } } } },
    }),
  );
  const view = render(
    <RegistryContext value={registry()}>{nodeFor(f.fans, "calc-inputs")}</RegistryContext>,
  );
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
  await vi.waitFor(() =>
    expect(f.fans.readingStatus("fans").snapshot.state === "ready").toBe(true),
  );
  f.fans.controls.query("rosterSearch", { ...emptyListSearch(), keywords: "FC" });
  const store = registry();
  const view = render(
    <RegistryContext value={store}>{nodeFor(f.fans, "calc-roster")}</RegistryContext>,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Search fans" }), {
    target: { value: "FC-23" },
  });
  await vi.waitFor(() => expect(f.fans.page.read().rosterSearch.keywords).toBe("FC-23"));
  f.fans.setPaneDemand("calc-roster", false);
  view.rerender(<RegistryContext value={store}>{null}</RegistryContext>);
  f.fans.setPaneDemand("calc-roster", true);
  view.rerender(<RegistryContext value={store}>{nodeFor(f.fans, "calc-roster")}</RegistryContext>);
  expect(screen.getByRole("combobox", { name: "Search fans" })).toHaveProperty("value", "FC-23");
});

test("no open fan is absence and every sheet pane renders without a native decode error", async () => {
  const f = await createWitness(closes, new Map(), {
    "fans.calc-detail-snapshot": {
      kind: "use",
      open(_ctx, deliver) {
        deliver({ kind: "complete", value: { kind: "absent" }, revision: 0 });
      },
    },
  });
  for (const pane of ["calc-roster", "calc-inputs", "calc-picture", "calc-ledger"]) {
    f.fans.setPaneDemand(pane, true);
    await vi.waitFor(() =>
      expect(f.fans.readingStatus("calcSnapshot").snapshot.state === "ready").toBe(true),
    );
    const view = render(
      <RegistryContext value={registry()}>{nodeFor(f.fans, pane)}</RegistryContext>,
    );
    if (pane === "calc-roster") expect(view.container.textContent).toContain("FC-23");
    // The picture pane is the kernel's, loaded lazily: its empty state arrives after the first paint.
    else expect(await screen.findByText("Open a fan from the roster.")).toBeTruthy();
    expect(view.container.textContent).not.toContain("readAt");
    view.unmount();
  }
});
