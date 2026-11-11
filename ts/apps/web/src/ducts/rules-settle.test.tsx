// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { pricingResult } from "@pe/ducts-domain/pricing-result";
import { cleanup, render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createWitness } from "../fans/cutover.test-support";
import { makeAtomRegistry } from "../shell/owner";
import { systemCode } from "./identity";
import { noTerminalSnapshot } from "./no-terminal.fixture";

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  for (const close of closes.splice(0).reverse()) close();
});

test("rules panes settle when the selected system has nothing to price, never 'Loading rules'", async () => {
  // The host's own refusal: pricingResult throws for a scope whose every group lacks a terminal.
  const refusal = (() => {
    try {
      pricingResult(noTerminalSnapshot(), {}, {}, null);
    } catch (error) {
      return error;
    }
    throw Error("fixture no longer refuses");
  })();
  const f = await createWitness(closes, new Map(), {
    "ducts.pricing.value": { kind: "use", open: (_ctx, deliver) => deliver({ kind: "failure", error: refusal }) },
  });
  await vi.waitFor(() => expect(f.owner.readingStatus("roster").snapshot.current).toBe(true));
  f.owner.controls.subject({ kind: "ids", ids: [systemCode("SA")] });
  await vi.waitFor(() =>
    expect(f.owner.readingStatus("value").snapshot).toMatchObject({ current: false, status: "unavailable" }),
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
