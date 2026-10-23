// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ductsDocumentSchema, type RouteStatePatch } from "@pe/agent-contracts";
import { assignFamilyRule, RuleAssignment } from "./rule-assignment";

afterEach(cleanup);

test("family choices show a refused or failed write and allow the person to retry", async () => {
  const write = vi
    .fn()
    .mockResolvedValueOnce({ code: "revision", message: "The Work changed; try again" })
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce(null);
  const work = { doc: ductsDocumentSchema.parse({}), write };
  render(<RuleAssignment family="Rectangular Elbow - Radius" work={work} />);
  const select = screen.getByRole("combobox");
  for (const message of ["The Work changed; try again", "Connection lost"]) {
    fireEvent.change(select, { target: { value: "elbow-mitered" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(message));
    expect(select.hasAttribute("disabled")).toBe(false);
  }
  fireEvent.change(select, { target: { value: "elbow-mitered" } });
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(write).toHaveBeenCalledTimes(3);
});

test("unstaging a family rule keeps its proposal", async () => {
  const proposal = { value: { rule: "elbow-mitered-vaned" } };
  const doc = ductsDocumentSchema.parse({
    ruleAssignments: { Radius: { proposal, staged: { value: { rule: "elbow-mitered" } } } },
  });
  const write = vi.fn(async (_patches: RouteStatePatch[]) => null);
  await assignFamilyRule({ doc, write }, "Radius", "");
  expect(write.mock.calls[0]?.[0]).toEqual([
    { path: ["ruleAssignments", "Radius", "staged"], value: null },
  ]);
  expect(doc.ruleAssignments.Radius?.proposal).toEqual(proposal);
});
