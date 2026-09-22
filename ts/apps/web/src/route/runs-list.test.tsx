// @vitest-environment jsdom
/** 7.3: a draft's run (origin SuppliedDraft) has no member; the pod scope lists it, labelled as such. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";

import type { Run } from "#/route/pods";
import { RunsList } from "#/route/runs-list";

afterEach(cleanup);

const run = (runId: string, receipt: object | null, error?: string) =>
  ({ runId, receiptPath: `output/${runId}/receipt.json`, receipt, error }) as unknown as Run;

const DRAFT = run("run-draft", {
  podId: "p",
  operation: "families.apply",
  outcome: "Succeeded",
  origin: "SuppliedDraft",
  memberPath: null,
  memberSha256: null,
  outputs: [],
});
const SAVED = run("run-saved", {
  podId: "p",
  operation: "schedule.apply",
  outcome: "Succeeded",
  origin: "SavedMember",
  memberPath: "settings/schedules/panel.json",
  memberSha256: "a".repeat(64),
  outputs: [],
});

test("the pod scope lists a draft's run on the one List, labelled a draft filed nowhere", () => {
  render(
    <RunsList
      runs={[DRAFT, SAVED, run("run-bad", null, "receipt.json is not JSON")]}
      scope="pod"
    />,
  );
  const list = screen.getByRole("listbox", { name: "the pod's runs" });
  expect(list.textContent).toContain("families.apply · Succeeded");
  expect(list.textContent).toContain("draft · filed nowhere");
  expect(list.textContent).not.toContain("not the saved bytes");
  // A saved member's run names its member at pod scope; a crashed run says why, not blank.
  expect(list.textContent).toContain("settings/schedules/panel.json");
  expect(list.textContent).toContain("receipt.json is not JSON");
});

test("an empty pod scope says what fills it", () => {
  render(<RunsList runs={[]} scope="pod" />);
  expect(screen.getByText(/no runs in this pod/)).toBeTruthy();
});
