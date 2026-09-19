// @vitest-environment jsdom
/**
 * F-J1-10: scope is a cell. Pea proposes `scope.proposal`; the person accepts or denies it with the
 * contract's own transitions, and their own "apply scope" stages only, leaving a differing
 * proposal standing as the counter-proposal (ruled by all).
 */
import type { AppliedFilter, FamiliesRouteDocument, RouteStatePatch } from "@pe/agent-contracts";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import type { CellWire } from "#/components/lang/band";

import { manifest } from "./manifest";
import { ScopeProposal } from "./scope-band";

afterEach(cleanup);

const PEAS = {
  categoryNames: ["Air Terminals"],
  familyNames: ["Price LBP15A Exhaust"],
  placementScope: "AllLoaded",
} as AppliedFilter;
const MINE = {
  categoryNames: ["Mechanical Equipment"],
  familyNames: [],
  placementScope: "PlacedOnly",
} as unknown as AppliedFilter;
type Scope = FamiliesRouteDocument["scope"];

function wired() {
  const writes: { patches: RouteStatePatch[]; revision?: number }[] = [];
  const wire: CellWire = {
    segment: "cells",
    revision: 7,
    write: vi.fn(async (patches: RouteStatePatch[], revision?: number) => {
      writes.push({ patches, revision });
      return null;
    }),
  };
  return { wire, writes };
}

test("a pending proposal says Pea proposes it; accept stages it in one bound write and it stands no longer", async () => {
  const { wire, writes } = wired();
  const scope: Scope = { proposal: { value: PEAS } };
  const view = render(<ScopeProposal scope={scope} wire={wire} />);
  expect(view.container.textContent).toContain(
    "Pea proposesAir Terminals · Price LBP15A Exhaust · all loaded",
  );
  await act(async () => fireEvent.click(view.getByRole("button", { name: /accept/ })));
  expect(writes).toEqual([
    { patches: [{ path: ["scope", "staged"], value: { value: PEAS } }], revision: 7 },
  ]);
  // What Work holds after that write: the staged scope IS the proposal, so nothing is pending.
  view.rerender(<ScopeProposal scope={{ ...scope, staged: { value: PEAS } }} wire={wire} />);
  expect(view.container.textContent).not.toContain("Pea proposes");
});

test("deny clears Pea's proposal and nothing else", async () => {
  const { wire, writes } = wired();
  const view = render(<ScopeProposal scope={{ proposal: { value: PEAS } }} wire={wire} />);
  await act(async () => fireEvent.click(view.getByRole("button", { name: /deny/ })));
  expect(writes).toEqual([
    { patches: [{ path: ["scope", "proposal"], value: null }], revision: 7 },
  ]);
});

test("the person's apply scope stages only; Pea's differing proposal stands as the counter-proposal", async () => {
  const write = vi.fn(async (_patches: RouteStatePatch[]) => undefined);
  const { run } = (
    manifest.actions as unknown as Record<string, { run: (ctx: unknown) => Promise<void> }>
  ).scope!;
  await run({
    page: {
      draft: {
        categories: MINE.categoryNames,
        families: MINE.familyNames,
        placement: MINE.placementScope,
      },
    },
    setPage: () => {},
    write,
  });
  expect(write.mock.calls).toEqual([[[{ path: ["scope", "staged"], value: { value: MINE } }]]]);
  const { wire } = wired();
  const view = render(
    <ScopeProposal scope={{ proposal: { value: PEAS }, staged: { value: MINE } }} wire={wire} />,
  );
  expect(view.container.textContent).toContain("Pea proposesAir Terminals");
  expect(view.getByRole("button", { name: /accept/ })).toBeTruthy();
});
