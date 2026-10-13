// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { FeedbackPicker, startFeedback } from "./feedback-picker";

vi.mock("#/readings", () => ({
  useAction: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}));
vi.mock("react-grab/primitives", () => ({
  getElementAtPoint: () => null,
  isElementGrabbable: () => true,
}));
afterEach(cleanup);

test("the one feedback owner portals its real cancel into the bar and keeps a standalone fallback", async () => {
  const tree = (host: boolean) => (
    <>
      {host && <span id="pe-feedback-cancel" />}
      <FeedbackPicker key="picker" hideTrigger />
    </>
  );
  const view = render(tree(true));
  act(() => startFeedback());
  const cancel = await screen.findByRole("button", { name: "cancel feedback" });
  expect(document.getElementById("pe-feedback-cancel")?.contains(cancel)).toBe(true);
  expect(cancel.closest("[data-feedback-chrome]")).toBeTruthy();
  fireEvent.click(cancel);
  await waitFor(() => expect(screen.queryByRole("button", { name: "cancel feedback" })).toBeNull());
  act(() => startFeedback());
  await screen.findByRole("button", { name: "cancel feedback" });
  view.rerender(tree(false));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "cancel feedback" }).closest(".fixed")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "cancel feedback" }));
  expect(screen.queryByRole("button", { name: "cancel feedback" })).toBeNull();
});
