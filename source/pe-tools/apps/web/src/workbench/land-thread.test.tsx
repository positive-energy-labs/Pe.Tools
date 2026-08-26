// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (options: object) => ({
      ...options,
      useSearch: () => ({ source: "live" as const, thread: undefined }),
    }),
    useNavigate: () => () => Promise.resolve(),
  };
});

import { TakeoffsRoute } from "#/routes/takeoffs";
import { landThread } from "./land-thread";

afterEach(cleanup);

test("no threads renders the empty state without minting", async () => {
  const request = vi.spyOn(globalThis, "fetch");

  expect(await landThread({ session: { listThreads: async () => [] } })).toBeUndefined();

  render(<TakeoffsRoute />);
  expect(screen.getByText("pick or start a thread")).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});
