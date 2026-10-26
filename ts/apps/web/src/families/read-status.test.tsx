// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { FamiliesReadStatus } from "./matrix";
import type { FamiliesReadProgress } from "@pe/agent-contracts";

afterEach(cleanup);

const progress: FamiliesReadProgress = {
  runId: "read-one",
  state: "reading",
  phase: "extracting",
  completed: 1,
  total: 8,
  workers: 2,
};

test("progress names the completed family count, phase, and workers before the read finishes", () => {
  render(<FamiliesReadStatus progress={progress} />);
  expect(screen.getByRole("status").textContent).toContain("1 of 8 families · extracting");
  expect(screen.getByRole("status").textContent).toContain("2 workers");
});

test("a cancelled read explicitly retains completed families; failed reads name the failure", () => {
  const view = render(<FamiliesReadStatus progress={{ ...progress, state: "cancelled" }} />);
  expect(screen.getByRole("status").textContent).toContain("completed families retained");
  view.rerender(
    <FamiliesReadStatus
      progress={{ ...progress, state: "failed", message: "worker disconnected" }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("worker disconnected");
});
