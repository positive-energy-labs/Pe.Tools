// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { ThreadList } from "#/components/thread-palette";
import { landThread } from "./land-thread";

afterEach(cleanup);

test("no threads renders the empty state without minting", async () => {
  const post = vi.fn(async () => ({ id: "minted" }));

  expect(
    await landThread({ session: { listThreads: async () => [], createThread: post } }),
  ).toBeUndefined();
  expect(post).not.toHaveBeenCalled();

  render(
    <ThreadList
      threads={[]}
      currentThreadId=""
      onSelect={() => undefined}
      onNew={() => undefined}
      onDelete={() => undefined}
      onSearch={() => undefined}
    />,
  );
  expect(screen.getByText("pick or start a thread")).toBeTruthy();
});
