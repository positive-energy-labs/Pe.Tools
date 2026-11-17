// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createWitness } from "@pe/fans-web/fans/cutover.test-support";
import { makeAtomRegistry } from "../../../../apps/web/src/shell/owner.ts";
import { systemCode } from "@pe/ducts-web/ducts/identity";
import { pricing } from "@pe/duct-systems-contract/ducts/contract";

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const close of closes.splice(0).reverse()) close();
});

test("rules panes settle when the selected system has nothing to price, never 'Loading rules'", async () => {
  const refusal = Error("EX 1 has no terminal; nothing to price");
  const f = await createWitness(closes, new Map(), {
    [pricing.key]: { kind: "use", open: (_ctx, deliver) => deliver({ kind: "failure", error: refusal }) },
  });
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.state === "ready").toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() =>
    expect(f.owner.readingStatus("value").snapshot).toMatchObject({ state: expect.stringMatching(/^(stale|refused)$/) }),
  );
  const registry = makeAtomRegistry();
  closes.push(() => registry.dispose());
  const panes = ["e-rules-all", "e-rules"].map((pane) => {
    const node = f.owner.read(pane);
    if (!isValidElement(node)) throw Error(`Pane ${pane} did not return a React element`);
    return <div key={pane}>{node}</div>;
  });
  render(<RegistryContext value={registry}>{panes}</RegistryContext>);
  expect(screen.getAllByText(/nothing to price/).length).toBeGreaterThan(0);
  expect(screen.queryAllByText("Loading rules")).toHaveLength(0);
});
