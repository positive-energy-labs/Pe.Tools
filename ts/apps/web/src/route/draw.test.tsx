// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { LAYER, readMarks, settled } from "../../../../tests/e2e/marks";
import { draw } from "./draw";
import { overlay, type PictureOverlayProps } from "./slots/picture/overlay";

afterEach(cleanup);

function heldDrawing() {
  const pending = Promise.withResolvers<{ Drawing: typeof Drawing }>();
  function Drawing({ ctx }: { ctx: string }) { return <p>{ctx}</p>; }
  return { ...pending, Drawing };
}

const readers = () => readMarks(LAYER);
const cases = ["body", "overlay"] as const;
function drawing(kind: typeof cases[number], promise: ReturnType<typeof heldDrawing>["promise"]) {
  if (kind === "body") return draw("scroll", () => promise, "Drawing")("Drawing ready").node;
  const paint = overlay(() => promise, "Drawing");
  return paint({ ctx: "Drawing ready", scope: {} as PictureOverlayProps<string>["scope"], picture: () => null });
}

test.each(cases)("%s: a pending lazy drawing blocks the exact driver marks until resolution", async (kind) => {
  const pending = heldDrawing();
  render(<section data-url-settled="">{drawing(kind, pending.promise)}</section>);
  expect(screen.getByText("Loading drawing")).toBeTruthy();
  expect(settled(readers())).toBe(false);
  expect(readers()).toEqual({ busy: true, urlSettled: true, picker: false });
  await act(async () => pending.resolve({ Drawing: pending.Drawing }));
  expect(screen.queryByText("Loading drawing")).toBeNull();
  expect(screen.getByText("Drawing ready")).toBeTruthy();
  expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  expect(settled(readers())).toBe(true);
});

test.each(cases)("%s: a hidden inert Place's pending drawing is ignored until shown", (kind) => {
  const pending = heldDrawing();
  const node = drawing(kind, pending.promise);
  const { rerender } = render(<><section data-url-settled="">Shown Place</section><section hidden inert>{node}</section></>);
  expect(screen.getByText("Loading drawing").closest("[inert]")).toBeTruthy();
  expect(settled(readers())).toBe(true);
  rerender(<><section data-url-settled="">Shown Place</section><section>{node}</section></>);
  expect(readers().busy).toBe(true);
  expect(settled(readers())).toBe(false);
});

class Failure extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() { return this.state.error ? <p role="alert">{this.state.error.message}</p> : this.props.children; }
}

test.each(cases)("%s: a rejected lazy drawing escapes Suspense into the error boundary", async (kind) => {
  const pending = heldDrawing();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    render(<section data-url-settled=""><Failure>{drawing(kind, pending.promise)}</Failure></section>);
    expect(screen.getByText("Loading drawing")).toBeTruthy();
    await act(async () => pending.reject(new Error("Drawing module refused")));
    expect(screen.getByRole("alert").textContent).toBe("Drawing module refused");
    expect(screen.queryByText("Loading drawing")).toBeNull();
    expect(readers().busy).toBe(false);
  } finally { consoleError.mockRestore(); }
});
