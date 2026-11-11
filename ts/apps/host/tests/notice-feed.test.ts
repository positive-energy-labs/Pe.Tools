/**
 * Slice 6 falsifier, one notice feed (ADR 0035 rule 7), host side: the `notices` Reading's first
 * frame is a `NoticeFeed` snapshot with every group present, built from the host's own stores.
 */
import { expect, test } from "vite-plus/test";
import { NOTICE_GROUPS, noticeFeedSchema, type ReadingFrame } from "@pe/agent-contracts";
import { createNoticeFeed } from "../src/notice-feed.ts";

test("red (slice 6 seam c): the notices Reading serves one grouped feed snapshot", () => {
  const frames: ReadingFrame[] = [];
  let feed: ReturnType<typeof createNoticeFeed>;
  try {
    feed = createNoticeFeed({
      build: () => ({ id: 0, tray: false, rows: [] }),
      subscribe: () => () => {},
    });
  } catch (error) {
    throw new Error(`slice 6 gap: ${String(error)}`);
  }
  const release = feed.observe({ kind: "notices" }, (frame) => frames.push(frame), null);
  expect(release, "the feed must own { kind: 'notices' }").toBeTypeOf("function");
  const first = frames[0];
  expect(first?.kind).toBe("snapshot");
  const parsed = noticeFeedSchema.parse((first as { value: unknown }).value);
  for (const group of NOTICE_GROUPS)
    expect(parsed.rows.filter((row) => row.group === group)).toEqual([]);
  release!();
  feed.close();
});
