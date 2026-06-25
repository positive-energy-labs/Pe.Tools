import { expect, test } from "vite-plus/test";
import type { HarnessThread } from "@mastra/core/harness";
import { nextForkTitle } from "../src/workbench-web.ts";

const thread = (id: string, title?: string): HarnessThread => ({
  id,
  title,
  resourceId: "r",
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

test("nextForkTitle numbers forks off the source's base title", () => {
  const src = thread("a", "Design review");
  expect(nextForkTitle([src], "a")).toBe("Design review (Fork 1)");
  expect(nextForkTitle([src, thread("b", "Design review (Fork 1)")], "a")).toBe(
    "Design review (Fork 2)",
  );
});

test("nextForkTitle forks a fork off the original base, taking the highest existing", () => {
  const threads = [
    thread("a", "Design review"),
    thread("b", "Design review (Fork 1)"),
    thread("c", "Design review (Fork 3)"),
  ];
  // Forking the fork "b" strips its suffix → base "Design review"; highest is 3 → 4.
  expect(nextForkTitle(threads, "b")).toBe("Design review (Fork 4)");
});

test("nextForkTitle falls back to 'Thread' when the source is untitled", () => {
  expect(nextForkTitle([thread("a")], "a")).toBe("Thread (Fork 1)");
});
