// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { CapturesList } from "./list";
vi.mock("#/host/runtime", () => ({ runtimeStreamUrl: (path: string) => `${path}?pe-runtime=checkout` }));
afterEach(cleanup);
test("a retained picture names its runtime owner and reports a failed image", async () => {
  const sha = "a".repeat(64);
  render(<CapturesList captures={[{ id: "taking", sha, at: "2026-11-06T00:00:00Z", origin: "human",
    document: { title: "MEP" }, view: { name: "Ground plan" }, focus: null, registration: null, byteSize: 93823,
    url: `/captures/${sha}.png` }]} focus={sha} open={[sha]} onPage={() => {}} />);
  const image = await screen.findByRole("img", { name: "Ground plan ? MEP" });
  expect(image.getAttribute("src")).toContain("pe-runtime=checkout");
  fireEvent.error(image);
  expect(screen.getByText(/The retained picture could not be loaded/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "open png" }).getAttribute("href")).toContain("pe-runtime=checkout");
});
