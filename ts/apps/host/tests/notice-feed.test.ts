/**
 * Slice 6 falsifier, one notice feed (ADR 0035 rule 7), host side: the `notices` Reading's first
 * frame is a `NoticeFeed` snapshot with every group present, built from the host's own stores.
 */
import { expect, test } from "vite-plus/test";
import { NOTICE_GROUPS, noticeFeedSchema, type ReadingFrame } from "@pe/agent-contracts";
import { createNoticeFeed } from "../src/notice-feed.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStoredNotices } from "@pe/host-contracts/store";
import { noteStartupHomes, noticeRows } from "../src/notice-feed.ts";

test("start census notices earlier Work once per folder without changing files", () => {
  const user = mkdtempSync(join(tmpdir(), "pe-earlier-work-"));
  const notices = join(user, "state", "stored-notices.jsonl");
  const work = join(user, "Work");
  const file = join(work, "a.json");
  const bytes = Buffer.from('{"staged":"keep me"}\r\n');
  mkdirSync(work);
  writeFileSync(file, bytes);
  const before = statSync(file, { bigint: true });
  try {
    noteStartupHomes(user, { root: null, looked: [] }, notices);
    const stored = readStoredNotices(notices);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ class: "keep", path: work });
    const text = `Work saved by an earlier version is at ${work}. This version no longer reads it. Nothing was changed or deleted. You may delete the folder.`;
    expect(stored[0]!.reason).toBe(text);
    const rows = noticeRows(
      { threads: [], receipts: [], works: [], machine: null, stored, held: [] },
      Date.parse(stored[0]!.at),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.says).toBe(text);
    const feedBytes = readFileSync(notices);
    noteStartupHomes(user, { root: null, looked: [] }, notices);
    expect(readStoredNotices(notices)).toHaveLength(1);
    expect(readFileSync(notices)).toEqual(feedBytes);
    expect(readdirSync(work)).toEqual(["a.json"]);
    expect(readFileSync(file)).toEqual(bytes);
    expect(statSync(file, { bigint: true }).mtimeNs).toBe(before.mtimeNs);
    // A different file in the same folder is still the same finding, not a new digest.
    writeFileSync(join(work, "b.txt"), "also kept");
    noteStartupHomes(user, { root: null, looked: [] }, notices);
    expect(readStoredNotices(notices)).toHaveLength(1);
  } finally {
    rmSync(user, { recursive: true, force: true });
  }
});

test("start census is silent for a missing or empty earlier Work folder", () => {
  const user = mkdtempSync(join(tmpdir(), "pe-no-earlier-work-"));
  const notices = join(user, "state", "stored-notices.jsonl");
  try {
    noteStartupHomes(user, { root: null, looked: [] }, notices);
    expect(readStoredNotices(notices)).toEqual([]);
    mkdirSync(join(user, "Work"));
    noteStartupHomes(user, { root: null, looked: [] }, notices);
    expect(readStoredNotices(notices)).toEqual([]);
  } finally {
    rmSync(user, { recursive: true, force: true });
  }
});

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

// Mutant, run red once (2026-11-11): `noteNoFirmHome` returns before its `noteStored` call.
test("no firm home posts one notice that names where the host looked, and it draws as one row", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readStoredNotices } = await import("@pe/host-contracts/store");
  const { noteNoFirmHome, noticeRows } = await import("../src/notice-feed.ts");
  const dir = mkdtempSync(join(tmpdir(), "pe-firm-notice-"));
  const notices = join(dir, "stored-notices.jsonl");
  const firm = join("04 PE Software Files", "Pe.Tools");
  const looked = [join("G:", "Shared drives", "*", firm), join("G:", firm)];
  try {
    // A bound firm home, and a probe that looked nowhere, say nothing.
    noteNoFirmHome({ root: join("G:", firm), looked }, notices);
    noteNoFirmHome({ root: null, looked: [] }, notices);
    expect(readStoredNotices(notices)).toEqual([]);
    // Unbound: one notice, however often the host starts.
    noteNoFirmHome({ root: null, looked }, notices);
    noteNoFirmHome({ root: null, looked }, notices);
    const stored = readStoredNotices(notices);
    expect(stored).toHaveLength(1);
    const rows = noticeRows(
      { threads: [], receipts: [], works: [], machine: null, stored, held: [] },
      Date.parse(stored[0]!.at),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ group: "failed", verb: "not found", what: "Firm home", revision: 0 });
    for (const place of looked) expect(rows[0]!.says).toContain(place);
    // Two markers are a different finding: it posts once more and names both.
    const refused = [join("P:", firm), join("G:", firm)];
    noteNoFirmHome({ root: null, looked, refused }, notices);
    const both = readStoredNotices(notices);
    expect(both).toHaveLength(2);
    for (const place of refused) expect(both[1]!.reason).toContain(place);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
