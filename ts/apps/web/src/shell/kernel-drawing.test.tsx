// @vitest-environment jsdom
import "../test-setup";
import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { LAYER, readMarks, settled } from "../../../../tests/e2e/marks";
import { kernelPane } from "./typed-shell";
import { mountTypedRoute } from "./typed-mount";
import { module as fans } from "../fans/route";
import { route } from "../route/typed-route";
import { workFingerprintSchema } from "@pe/agent-contracts";

const pending = vi.hoisted(() => Promise.withResolvers<{ PicturePane: () => React.ReactNode }>());
vi.mock("../route/slots/picture/pane.tsx", () => pending.promise);
// Root-config proof lane has no artifact build define; it is unrelated to drawing readiness.
vi.mock("../host/build-stamp", () => ({ webBuildStamp: { version: "test", build: "test" } }));

test("the actual kernel picture Suspense blocks driver settledness until its module resolves", async () => {
  const mount = mountTypedRoute(route({ ...fans.spec, edits: undefined }), {
    target: null, fixture: "layout", work: { address: null, open: null },
    address: { read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} },
    custody: { current: () => true }, memory: () => ({}),
  }, workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`));
  try {
    render(<section data-url-settled="">{mount.draw("sheet-picture", ctx => kernelPane(mount, "sheet-picture", ctx))}</section>);
    expect(screen.getByText("Loading drawing")).toBeTruthy();
    expect(settled(readMarks(LAYER))).toBe(false);
    await act(async () => pending.resolve({ PicturePane: () => <p>Picture ready</p> }));
    expect(screen.getByText("Picture ready")).toBeTruthy();
    expect(screen.queryByText("Loading drawing")).toBeNull();
    expect(readMarks(LAYER).busy).toBe(false);
    expect(settled(readMarks(LAYER))).toBe(true);
  } finally { cleanup(); mount.dispose(); }
});
