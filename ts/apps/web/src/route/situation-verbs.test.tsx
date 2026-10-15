// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ActionBoard } from "./situation-verbs";
import type { RouteHandle, ActionHandle } from "./handle";

vi.mock("#/navigation/route-controls", () => ({ useSituationPresentation: () => true }));
afterEach(cleanup);
test("disclosure keeps the same action button and its dismissed flag across both layouts", async () => {
  const action = {
    label: "Read",
    says: "Read the model",
    count: null,
    refusal: null,
    chord: undefined,
    actor: "human",
    needs: "document",
    run: vi.fn(),
  } as unknown as ActionHandle;
  const handle = {
    manifest: { key: "family", actions: { read: { dirties: [] } } },
    readings: {},
    work: { changed: false },
    busy: null,
    outcome: { key: "read", at: 1, refusal: { message: "A refused read", cells: [] } },
    stop: vi.fn(),
  } as unknown as RouteHandle<any, any, any, any>;
  render(<ActionBoard handle={handle} verbs={[["read", action]]} work="r1" />);
  const button = screen.getByRole("button", { name: "Read" });
  await screen.findByText("A refused read");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByText("A refused read")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "verbs" }));
  expect(screen.getByRole("button", { name: "Read" })).toBe(button);
  expect(screen.queryByText("A refused read")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "verbs" }));
  expect(screen.getByRole("button", { name: "Read" })).toBe(button);
  expect(screen.queryByText("A refused read")).toBeNull();
});
