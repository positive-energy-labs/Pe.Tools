import { describe, expect, it } from "vite-plus/test";
import type { HarnessThreadSummary } from "@pe/agent-contracts";
import { HOST_RESTARTED } from "@pe/agent-contracts/chat-state";
import { LEDGER_GROUPS, ledgerRows, LEDGER_PRESENTATIONS, presentLedger } from "./ledger-model";

const now = Date.parse("2026-10-14T12:00:00Z");
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const thread = (
  id: string,
  state: HarnessThreadSummary["activity"]["state"],
  at: string,
  extra: { message?: string | null; pending?: number; unread?: boolean } = {},
): HarnessThreadSummary =>
  ({
    id,
    harness: "claude",
    providerId: "claude",
    providerName: "Claude Code",
    title: `thread ${id}`,
    createdAt: at,
    updatedAt: at,
    modelId: null,
    lastSeq: 10,
    head: { defaultTarget: null, revision: 0 },
    lifecycle: {
      revision: 1,
      autoSettle: "manual",
      settledAt: null,
      reopenedAt: null,
      order: null,
      pinned: false,
      status: "active",
      snoozedUntil: null,
      snoozedSeq: 0,
      readSeq: extra.unread ? 2 : 10,
      explicitUnread: false,
    },
    activity: { state, pending: extra.pending ?? 0, lastSeq: 10, message: extra.message ?? null },
  }) as HarnessThreadSummary;

const sources = (threads: HarnessThreadSummary[]) => ({
  threads,
  asks: new Map(),
  receipts: [],
  works: [],
  attention: [],
});

describe("open-work ledger rows", () => {
  it("shows a host-restart death as interrupted with Resume, never failed, and drops it after a day", () => {
    const rows = ledgerRows(
      sources([
        thread("cut", "failed", hoursAgo(3), { message: HOST_RESTARTED }),
        thread("old-cut", "failed", hoursAgo(30), { message: HOST_RESTARTED }),
        thread("broke", "failed", hoursAgo(3), { message: "provider refused the key" }),
      ]),
      now,
    );
    const cut = rows.find((row) => row.key === "thread:cut");
    expect(cut).toMatchObject({ group: "interrupted", verb: "interrupted", resume: "cut" });
    expect(rows.some((row) => row.key === "thread:old-cut")).toBe(false);
    expect(rows.find((row) => row.key === "thread:broke")).toMatchObject({
      group: "failed",
      says: "provider refused the key",
    });
    expect(rows.filter((row) => row.group === "failed")).toHaveLength(1);
  });
  it("puts an unknown outcome in waits with its own sentence and no invented address", () => {
    const receipt = {
      kind: "workflow",
      id: "r1",
      key: "instances.start",
      caller: { kind: "human", via: "local" },
      basis: null,
      destination: { kind: "host" },
      request: {},
      bases: {},
      steps: [],
      preparation: { state: "unprepared" },
      recovery: [],
      startedAt: hoursAgo(5),
      publication: { state: "unrequested" },
      state: "unknown",
      error: "session.bootstrap-mismatch",
      status: 409,
    } as never;
    const [row] = ledgerRows({ ...sources([]), receipts: [receipt] }, now);
    expect(row).toMatchObject({
      group: "waits",
      verb: "unknown",
      where: "workflow · human",
      says: "session.bootstrap-mismatch",
      url: null,
    });
    expect(row?.refusal).toBeTruthy();
  });
  it("puts a Work with pending Pea proposals in waits with its resume address, and leaves other Works to Home's directory", () => {
    const work = (id: string, proposals: number, url: string | null) => ({
      id,
      route: "takeoffs",
      label: "Takeoffs",
      context: id,
      state: "ready",
      url,
      reason: url ? null : "Open that document to resume.",
      revision: 1,
      proposals,
    });
    const rows = ledgerRows(
      {
        ...sources([]),
        works: [work("A.rvt", 2, "/takeoffs?target=a"), work("B.rvt", 0, null)],
      },
      now,
    );
    expect(rows.map((row) => [row.group, row.verb, row.url])).toEqual([
      ["waits", "review", "/takeoffs?target=a"],
    ]);
    expect(rows[0]?.says).toBe("2 Pea proposals to review");
  });
  it("leads with waits and working whatever their age", () => {
    const rows = ledgerRows(
      sources([
        thread("unread", "idle", hoursAgo(0), { unread: true }),
        thread("asks", "waiting", hoursAgo(50), { pending: 1 }),
        thread("runs", "running", hoursAgo(40)),
        thread("broke", "failed", hoursAgo(1), { message: "boom" }),
      ]),
      now,
    );
    expect(rows.map((row) => row.group)).toEqual(["waits", "working", "failed", "unread"]);
  });
});

describe("ledger presentations", () => {
  const many = (group: "waits" | "working" | "failed" | "unread", n: number) =>
    Array.from({ length: n }, (_, i) =>
      thread(
        `${group}${i}`,
        group === "waits"
          ? "waiting"
          : group === "working"
            ? "running"
            : group === "failed"
              ? "failed"
              : "idle",
        hoursAgo(1),
        {
          pending: group === "waits" ? 1 : 0,
          message: group === "failed" ? "boom" : null,
          unread: group === "unread",
        },
      ),
    );
  const rows = ledgerRows(
    sources([
      ...many("waits", 9),
      ...many("working", 7),
      ...many("failed", 6),
      ...many("unread", 58),
    ]),
    now,
  );
  const shape = (id: keyof typeof LEDGER_PRESENTATIONS, open: string[] = []) =>
    presentLedger(rows, LEDGER_PRESENTATIONS[id], new Set(open) as never).reduce<
      Record<string, string>
    >((groups, item) => {
      const group = item.kind === "row" ? item.row.group : item.group;
      if (item.kind === "row" || item.count)
        groups[group] = `${groups[group] ?? ""}${item.kind === "row" ? "r" : `+${item.count}`}`;
      return groups;
    }, {});
  it("never folds waits or working, folds unread to one count in the tray and overlay", () => {
    for (const id of ["tray", "overlay", "home"] as const) {
      expect(shape(id).waits).toBe("r".repeat(9));
      expect(shape(id).working).toBe("r".repeat(7));
    }
    expect(shape("tray").unread).toBe("+58");
    expect(shape("overlay").unread).toBe("+58");
    expect(shape("overlay").failed).toBe("rrr+3");
    expect(shape("home").unread).toBe("rrrrr+53");
    expect(shape("overlay", ["failed"]).failed).toBe("r".repeat(6));
  });
  it("keeps an empty waits or working group visible as a stated nothing in every presentation", () => {
    const quiet = ledgerRows(
      sources([thread("broke", "failed", hoursAgo(1), { message: "boom" })]),
      now,
    );
    for (const id of ["tray", "overlay", "home"] as const) {
      const items = presentLedger(quiet, LEDGER_PRESENTATIONS[id], new Set());
      expect(items.slice(0, 2)).toEqual([
        { kind: "note", key: "note:waits", group: "waits", count: 0, text: "Nothing waits on you" },
        {
          kind: "note",
          key: "note:working",
          group: "working",
          count: 0,
          text: "Nothing is working",
        },
      ]);
    }
  });
  it("draws the counter strip in the tray only, waits then working first", () => {
    expect(LEDGER_PRESENTATIONS.tray.counters).toBe(true);
    expect(LEDGER_PRESENTATIONS.home.counters).toBe(false);
    expect(LEDGER_PRESENTATIONS.overlay.counters).toBe(false);
    expect(LEDGER_GROUPS.slice(0, 2)).toEqual(["waits", "working"]);
  });
});
