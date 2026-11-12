/**
 * ADR 0039 falsifiers, one seeded corrupt file per stored kind the host reads through `readStored`.
 * `keep`: the file is listed "can't read, kept" and its bytes are unchanged. `discard`: the corrupt
 * bytes are gone, with exactly one notice that a second read or start does not repeat. No reader
 * throws, so no stored file can stop the host.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { readStoredNotices } from "@pe/host-contracts/store";
import { noticeRows, storedNoticesPath } from "../src/notice-feed.ts";
import { createPackageLifecycle } from "../src/package-lifecycle.ts";
import { listPackages } from "../src/packages.ts";
import { createPodRoutes } from "../src/pod-routes.ts";
import { createDevices } from "../src/remote-device.ts";
import { readRemoteIngress } from "../src/remote-ingress.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";
import { createScheduledTasks } from "../src/scheduled-tasks.ts";
import { shareIntentFile } from "../src/share.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { createUpdateReader } from "../src/update-reader.ts";
import { journalAt } from "./effect-test.ts";

const CORRUPT = "{ this is not JSON";
/** JSON that no stored kind here accepts: every one is an object or a list of objects. */
const WRONG_SHAPE = JSON.stringify(["wrong shape"]);
const HEX = "a".repeat(64);

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pe-store-policies-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const seed = (path: string, bytes: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
};
const posted = (path: string) =>
  readStoredNotices(storedNoticesPath()).filter((notice) => notice.path === path);
const holds = (path: string, bytes: string) =>
  existsSync(path) && readFileSync(path, "utf8") === bytes;

/** A discard-class kind: `read` meets the seeded file the way the host does, and must not throw. */
type Kind = { name: string; place: string; file: () => string; read: (path: string) => unknown };
const scheduler = (path: string) =>
  createScheduledTasks({
    path,
    receipts: { read: async () => [], subscribe: () => () => {} },
    evidence: () => new Set<string>(),
    launch: () => ({ threadId: "t", completion: Promise.resolve() }),
  }).close();
const kinds: Kind[] = [
  {
    name: "scheduled tasks",
    place: "Scheduled tasks",
    file: () => join(root, "scheduled-tasks.json"),
    read: scheduler,
  },
  {
    name: "paired devices",
    place: "Paired devices",
    file: () => join(root, "devices.json"),
    read: (path) => createDevices(path).list(),
  },
  {
    name: "share intent",
    place: "Sharing",
    file: () => join(root, "share.json"),
    read: (path) => shareIntentFile(path).load(),
  },
  {
    name: "update admission",
    place: "Update status",
    file: () => join(root, "update.json"),
    read: (path) =>
      createUpdateReader({
        path,
        run: async () => {
          throw Error("no SDK in this test");
        },
        installed: true,
        pid: 1,
      }).refresh(false),
  },
  {
    name: "Pod on and off choices",
    place: "Pod on and off choices",
    file: () => join(root, "plugins.json"),
    read: (path) =>
      createPackageLifecycle({
        packages: () => listPackages(join(root, "Pods")),
        decisionsPath: path,
      }).ready,
  },
  {
    name: "Pod route trust",
    place: "Pod route trust",
    file: () => join(root, "route-trust.json"),
    read: (path) =>
      createPodRoutes(
        createPackageLifecycle({
          packages: () => listPackages(join(root, "Pods")),
          decisionsPath: join(root, "none.json"),
        }),
        { trustPath: path },
      ).list(),
  },
  {
    name: "a retained schedule reading",
    place: "Captures",
    file: () => join(root, "captures", "schedules", `${HEX}.json`),
    read: () => captures().scheduleHistory("any-workspace"),
  },
];
const captures = () =>
  new TakeoffCaptures(join(root, "captures"), join(root, "aps.json"), () => "2026-11-11T00:00:00Z");

describe("discard: the corrupt bytes are gone, with one notice that does not repeat", () => {
  test.each(kinds)("$name", async ({ place, file, read }) => {
    const path = seed(file(), CORRUPT);
    await read(path);
    expect(holds(path, CORRUPT), "the corrupt bytes are gone").toBe(false);
    expect(posted(path)).toMatchObject([{ class: "discard", place }]);
    // A second read, and a second start over the same store, post nothing new.
    await read(path);
    await read(path);
    expect(posted(path)).toHaveLength(1);
    // The same holds for a file that is JSON of the wrong shape: a second, different loss.
    if (place === "Captures") return; // `unknown` accepts any JSON; a stale reading is refused typed.
    seed(path, WRONG_SHAPE);
    await read(path);
    expect(holds(path, WRONG_SHAPE)).toBe(false);
    expect(posted(path)).toHaveLength(2);
  });

  test("Work: a read and a listing discard the same file the same way", async () => {
    const dir = join(root, "Work");
    const store = fileRouteDocumentStore(dir);
    const name = (route: string, targetKey: string) =>
      `${createHash("sha256").update(`${route}:${targetKey}`).digest("hex")}.json`;
    const read = seed(join(dir, name("ducts", "doc-a")), CORRUPT);
    expect(await store.getState({ route: "ducts", targetKey: "doc-a" })).toBeNull();
    expect(existsSync(read)).toBe(false);
    expect(posted(read)).toMatchObject([{ class: "discard", place: "Work for ducts (doc-a)" }]);
    expect(await store.getState({ route: "ducts", targetKey: "doc-a" })).toBeNull();
    expect(posted(read)).toHaveLength(1);

    const listed = seed(join(dir, name("fans", "doc-b")), CORRUPT);
    const misplaced = seed(
      join(dir, name("fans", "doc-c")),
      JSON.stringify({ format: "route-state-record-v2", targetKey: "other", route: "fans", value: 1 }),
    );
    expect(await store.listState!()).toMatchObject({ records: [], unreadable: 2, unindexed: 0 });
    expect(existsSync(listed) || existsSync(misplaced)).toBe(false);
    expect(posted(listed)).toHaveLength(1);
    expect(posted(misplaced)).toHaveLength(1);
    // The next listing meets nothing, and posts nothing.
    expect(await store.listState!()).toMatchObject({ records: [], unreadable: 0, unindexed: 0 });
    expect([read, listed, misplaced].map((path) => posted(path).length)).toEqual([1, 1, 1]);
  });

  test.each([
    ["a header that is not JSON", `${CORRUPT}\n`],
    ["a corrupt line", `{"version":8}\n${CORRUPT}\n{"mapping":["k","${crypto.randomUUID()}"]}\n`],
    ["a line of the wrong shape", `{"version":8}\n${WRONG_SHAPE}\n\n`],
  ])("the action journal with %s is discarded and the journal still works", async (_, bytes) => {
    const path = seed(join(root, "journal", "journal.jsonl"), bytes);
    const journal = journalAt(path, Date.now);
    expect(await journal.list()).toEqual([]);
    expect(posted(path)).toMatchObject([{ class: "discard", place: "Action journal" }]);
    // Before this, the throw was cached and every later journal write rejected.
    const join_ = await journal.actionJoin("first-action");
    expect(readFileSync(path, "utf8").split("\n")[0]).toBe('{"version":8}');
    // A second start over the journal it left reads it, and posts nothing.
    expect(await journalAt(path, Date.now).actionJoin("first-action")).toEqual(join_);
    expect(posted(path)).toHaveLength(1);
  });

  test("captures read by id: a corrupt one is discarded, then reads as missing", async () => {
    const store = captures();
    const family = seed(join(root, "captures", "family", `${HEX}.json`), CORRUPT);
    await expect(store.family(HEX)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(store.family(HEX)).rejects.toMatchObject({ code: "ENOENT" });
    expect(existsSync(family)).toBe(false);
    expect(posted(family)).toMatchObject([{ class: "discard", place: "Captures" }]);

    const families = seed(join(root, "captures", "families", `${HEX}.json`), WRONG_SHAPE);
    await expect(store.families(HEX)).rejects.toMatchObject({ code: "ENOENT" });
    expect(existsSync(families)).toBe(false);
    expect(posted(families)).toHaveLength(1);

    const progress = seed(join(root, "captures", "families", "progress", `${HEX}.json`), CORRUPT);
    await expect(store.families(HEX)).rejects.toMatchObject({ code: "ENOENT" });
    expect(existsSync(progress)).toBe(false);
    expect(posted(progress)).toHaveLength(1);
  });
});

describe("keep: an authored file is listed \"can't read, kept\" and its bytes never change", () => {
  test.each([CORRUPT, WRONG_SHAPE])("remote ingress holding %s", (bytes) => {
    const path = seed(join(root, "remote-ingress.json"), bytes);
    expect(readRemoteIngress(path)).toBeNull();
    expect(readRemoteIngress(path)).toBeNull();
    expect(readFileSync(path, "utf8")).toBe(bytes);
    const notices = posted(path);
    expect(notices).toMatchObject([{ class: "keep", place: "Remote ingress configuration" }]);
    // The feed lists it, once, in those words.
    const rows = noticeRows(
      { threads: [], receipts: [], works: [], machine: null, stored: notices },
      Date.now(),
    );
    expect(rows).toMatchObject([
      { group: "failed", verb: "kept", what: "Remote ingress configuration", detail: path },
    ]);
    expect(rows[0]!.says).toMatch(/^Can't read, kept: .+/);
  });
});

test("host start throws 0 times over corrupt scheduled tasks, devices and remote ingress", async () => {
  const tasks = seed(join(root, "scheduled-tasks.json"), CORRUPT);
  const devices = seed(join(root, "devices.json"), CORRUPT);
  const ingress = seed(join(root, "remote-ingress.json"), CORRUPT);
  let thrown = 0;
  // The three reads `app.ts` and `pe-routes.ts` make while the host starts, in their order.
  for (const start of [
    () => readRemoteIngress(ingress),
    () => createDevices(devices).list(),
    () => scheduler(tasks),
  ])
    try {
      await start();
    } catch {
      thrown++;
    }
  expect(thrown).toBe(0);
  // The host then runs on fresh machine state, and the hand-written file is untouched.
  expect(JSON.parse(readFileSync(tasks, "utf8"))).toBeInstanceOf(Array);
  expect(JSON.parse(readFileSync(devices, "utf8"))).toMatchObject({ sessions: [] });
  expect(readFileSync(ingress, "utf8")).toBe(CORRUPT);
});

test("a discard is a feed row for a week, and its card can raise only once", () => {
  const notice = {
    class: "discard" as const,
    place: "Work for ducts (doc-a)",
    path: join(root, "work.json"),
    sha256: HEX,
    reason: "Unexpected token",
    at: "2026-11-11T00:00:00.000Z",
  };
  const rows = (now: string) =>
    noticeRows(
      { threads: [], receipts: [], works: [], machine: null, stored: [notice] },
      Date.parse(now),
    );
  expect(rows("2026-11-12T00:00:00Z")).toMatchObject([
    {
      key: `stored:${notice.path}:${HEX}`,
      group: "failed",
      revision: 0,
      verb: "discarded",
      what: "Work for ducts (doc-a)",
      says: "Could not be read, so it was discarded: Unexpected token",
      url: null,
    },
  ]);
  expect(rows("2026-11-19T00:00:01Z")).toEqual([]);
});
