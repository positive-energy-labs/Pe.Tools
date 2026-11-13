// @vitest-environment jsdom
import "../test-setup";
import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { LAYER, readMarks, settled } from "../../../../tests/e2e/marks";
import { kernelPane } from "./typed-shell";

const pending = vi.hoisted(() => Promise.withResolvers<{ PicturePane: () => React.ReactNode }>());
vi.mock("../route/slots/picture/pane.tsx", () => pending.promise);
// Root-config proof lane has no artifact build define; it is unrelated to drawing readiness.
vi.mock("../host/build-stamp", () => ({ webBuildStamp: { version: "test", build: "test" } }));

test("the actual kernel picture Suspense blocks driver settledness until its module resolves", async () => {
  // Only the fields kernelPane reads; the controlled import replaces the renderer, not Suspense.
  const mount = { spec: { panes: { picture: { kernel: "picture" } }, picture: {}, name: "Picture" }, findings: () => [] } as unknown as Parameters<typeof kernelPane>[0];
  try {
    render(<section data-url-settled="">{kernelPane(mount, "picture", {} as Parameters<typeof kernelPane>[2])}</section>);
    expect(screen.getByText("Loading drawing")).toBeTruthy();
    expect(settled(readMarks(LAYER))).toBe(false);
    await act(async () => pending.resolve({ PicturePane: () => <p>Picture ready</p> }));
    expect(screen.getByText("Picture ready")).toBeTruthy();
    expect(screen.queryByText("Loading drawing")).toBeNull();
    expect(readMarks(LAYER).busy).toBe(false);
    expect(settled(readMarks(LAYER))).toBe(true);
  } finally { cleanup(); }
});
