// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { dismiss, point, pointerThread, readPointers } from "../../../host/src/pointers";

// The host store behind the ops Pea calls; the list reads and dismisses through the same door.
vi.mock("./readings-api", () => ({
  callOp: vi.fn(async (_ctx: unknown, key: string, request: { thread: string; id?: string }) =>
    key === "pointers.dismiss" ? dismiss(request.thread, request.id!) : readPointers(request.thread),
  ),
}));
import { PointerList } from "./pointer-list";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";

afterEach(cleanup);

test("a pointer Pea makes in this thread lists on its route, and dismiss removes it; the URL never moves", async () => {
  point(pointerThread({ kind: "pea", thread: "t1" } as never, undefined), {
    route: "fans",
    place: { selected: '["e:7"]' },
    label: "FC-1 fan flow",
  });
  point("t1", { route: "ducts", place: {}, label: "elsewhere" });
  const url = window.location.href;
  render(
    <WorkbenchContext.Provider value={{ currentThreadId: "t1" } as never}>
      <PointerList route="fans" />
    </WorkbenchContext.Provider>,
  );
  await act(async () => {});
  expect(screen.getByText("Pea is pointing at FC-1 fan flow")).toBeTruthy();
  expect(screen.queryByText(/elsewhere/)).toBeNull();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Dismiss FC-1 fan flow" })));
  expect(screen.queryByText(/FC-1 fan flow/)).toBeNull();
  expect(readPointers("t1").pointers.map((p) => p.label)).toEqual(["elsewhere"]);
  expect(window.location.href).toBe(url);
});
