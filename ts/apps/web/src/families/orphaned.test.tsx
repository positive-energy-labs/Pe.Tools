// @vitest-environment jsdom
/**
 * 21 orphaned cells: a staged cell whose family name the plan could not resolve (its entry has no
 * id, and the host says why, by name) draws orphaned with that reason, and clearing it stays free.
 */
import { familyCellKey, type FamilyCellState } from "@pe/agent-contracts";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import { FamiliesProposalsBand } from "./readout-bands";
import { FamiliesWorkspaceProvider } from "./workspace-context";

afterEach(cleanup);

const REFUSAL = "no loaded family named 'Ghost'";
const key = (familyName: string) =>
  familyCellKey({ familyName, typeName: "T", parameter: "Model" });

test("a cell the plan could not resolve by name draws orphaned, with the host's reason, and clears", () => {
  const cells: Record<string, FamilyCellState> = {
    [key("Ghost")]: { proposal: null, staged: { value: { value: "x" } } },
    [key("Alpha")]: { proposal: null, staged: { value: { value: "y" } } },
  };
  const plan = {
    entries: [
      // The refused name: no id resolved, the host's words as its flag.
      {
        id: "Ghost",
        name: "Ghost",
        planHash: "",
        actions: 0,
        detail: "",
        flag: REFUSAL,
        warnings: [],
      },
      {
        id: "Alpha",
        name: "Alpha",
        hashKey: "7",
        planHash: "p",
        actions: 1,
        detail: "",
        flag: null,
        warnings: [],
      },
    ],
  };
  render(
    <FamiliesWorkspaceProvider
      value={
        {
          cells,
          rows: [],
          params: [],
          plan,
          wire: { segment: "cells", revision: 1, write: async () => null },
        } as never
      }
    >
      <FamiliesProposalsBand />
    </FamiliesWorkspaceProvider>,
  );
  const row = (name: string) =>
    within(
      document.querySelector(`[data-proposal-row='${key(name)}']`)!.closest("div")!
        .parentElement as HTMLElement,
    );
  expect(row("Ghost").getByText("orphaned")).toBeTruthy();
  expect(row("Ghost").getByText(REFUSAL)).toBeTruthy();
  expect(row("Ghost").getByRole("button", { name: /unstage/ })).toBeTruthy();
  expect(row("Alpha").queryByText("orphaned")).toBeNull();
});
