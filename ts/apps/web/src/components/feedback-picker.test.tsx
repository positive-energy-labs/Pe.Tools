// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { FeedbackPicker, startFeedback } from "./feedback-picker";

const grab = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("react-grab/primitives", () => ({
  getElementContext: grab.context,
  getElementBounds: () => ({ x: 0, y: 0, width: 80, height: 40 }),
  getElementAtPoint: () => null,
  isElementGrabbable: () => true,
}));
vi.mock("#/readings", () => ({
  useAction: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}));
vi.mock("#/route/keys", () => ({ useScopeKeys: () => {} }));
vi.mock("#/host/feedback", () => ({ sendFeedback: vi.fn() }));

afterEach(() => {
  cleanup();
  grab.context.mockReset();
});

test("tutorial starts the existing hidden picker and cancellation remains accessible", () => {
  const screen = render(<FeedbackPicker hideTrigger />);
  expect(screen.queryByRole("button", { name: "feedback" })).toBeNull();
  act(() => startFeedback());
  fireEvent.click(screen.getByRole("button", { name: "cancel feedback" }));
  expect(screen.queryByRole("button", { name: "cancel feedback" })).toBeNull();
});

test("message capture uses the supplied element and cannot reopen a cancelled note", async () => {
  let finish!: (value: unknown) => void;
  grab.context.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const screen = render(
    <>
      <section data-testid="message">Message</section>
      <FeedbackPicker hideTrigger />
    </>,
  );
  const message = screen.getByTestId("message");
  act(() => startFeedback(message));
  await waitFor(() => expect(grab.context).toHaveBeenCalledExactlyOnceWith(message));
  fireEvent.click(screen.getByRole("button", { name: "cancel feedback" }));
  await act(async () =>
    finish({ selector: "section", componentName: "Message", stack: [], htmlPreview: "Message" }),
  );
  expect(screen.queryByLabelText("feedback note")).toBeNull();
  expect(screen.queryByPlaceholderText("What's wrong or what should change?")).toBeNull();
});
