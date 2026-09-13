// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vite-plus/test";
import { SessionBadge } from "./world-badge";

afterEach(cleanup);

test("shows the honest local world fallback", () => {
  render(
    <SessionBadge
      world={{
        id: "pea:root",
        root: "C:\\work",
        storage: { kind: "local-unversioned" },
        isolation: "none",
      }}
    />,
  );
  expect(screen.getByText("Local folder · unversioned · this machine only")).toBeTruthy();
  expect(
    screen.getByLabelText(
      "Pea is using C:\\work. Files persist locally. Mesa checkpoints, history, diffs, and cross-machine reopen are unavailable. Commands are not OS-isolated.",
    ),
  ).toBeTruthy();
});
