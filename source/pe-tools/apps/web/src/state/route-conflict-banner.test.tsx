// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RegistryContext } from "@effect/atom-react";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { afterEach, expect, it } from "vite-plus/test";

import { RouteConflictBanner } from "../routes/__root";
import { routeConflictAtom } from "./route-store";

afterEach(cleanup);

it("mounts one dismissible changed-elsewhere banner", () => {
  const registry = AtomRegistry.make();
  registry.set(routeConflictAtom, true);

  render(
    <RegistryContext.Provider value={registry}>
      <RouteConflictBanner />
    </RegistryContext.Provider>,
  );

  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByText("Changed elsewhere")).toBeTruthy();
  expect(screen.getByText(/edit did not land/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "dismiss" }));
  expect(screen.queryByRole("status")).toBeNull();
});
