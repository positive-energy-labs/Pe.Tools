// @vitest-environment jsdom
/**
 * Slice 6 falsifier, one notice feed (ADR 0035 rule 7): home Activity, tray Activity and the
 * Mod+Shift+K overlay draw the host's `notices` Reading as it is, with no browser join of thread
 * summaries, `actions.read` and Works. Every other source is dead here: a row can only come from
 * the feed.
 */
import type { NoticeFeed } from "@pe/agent-contracts";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const feed: NoticeFeed = {
  id: 7,
  tray: false,
  rows: [
    {
      key: "thread:t1",
      group: "waits",
      revision: 1,
      verb: "held",
      what: "Wiring",
      where: "Claude",
      says: "Delete the schedule",
      at: "2026-11-10T12:00:00.000Z",
      url: "/pea?thread=t1",
      act: { kind: "confirm-send", id: "h1", to: "LlamaCloud", detail: "pages 1-5" },
    },
    {
      key: "action:a1",
      group: "failed",
      revision: 1,
      verb: "failed",
      what: "revit.ducts.resize",
      where: "Pea",
      says: "Revit never answered",
      at: "2026-11-10T11:00:00.000Z",
      url: null,
      refusal: "No address yet: this receipt has no page",
    },
  ],
};

vi.mock("#/host/resource-state", async (actual) => ({
  ...(await actual<typeof import("#/host/resource-state")>()),
  useReading: (request: { kind: string } | null) =>
    request?.kind === "notices" ? { state: "ready", observation: feed } : { state: "absent" },
}));
// Dead sources: the join that the feed replaces finds nothing here.
vi.mock("#/workbench/provider/harness-client", () => ({
  harnessClient: () => ({ summaries: () => () => {} }),
}));
vi.mock("#/workbench/config", () => ({ resolveWorkbenchConfig: () => ({ origin: "" }) }));
vi.mock("#/host/pe-client", () => ({ peClient: { call: vi.fn(async () => []) } }));
vi.mock("#/machine/use-machine", () => ({ useMachine: () => ({ reading: { state: "absent" } }) }));
vi.mock("#/navigation/state", () => ({
  useNavigation: () => ({ snapshot: null, loading: false, error: undefined, refresh() {} }),
  useDestination: () => () => true,
}));
vi.mock("#/route/pod-route-context", () => ({ usePodRoutes: () => null }));
afterEach(cleanup);

const GAP =
  "slice 6 gap: navigation/ledger.tsx still joins thread summaries, actions.read and Works in the browser instead of reading the notice feed";

test("red (slice 6 seam c): home Activity reads the notice feed", async () => {
  const { Ledger } = await import("./ledger");
  const { LEDGER_PRESENTATIONS } = await import("./ledger-model");
  render(<Ledger presentation={LEDGER_PRESENTATIONS.home} />);
  expect(screen.queryByText("Wiring"), GAP).not.toBeNull();
  expect(screen.queryByText("revit.ducts.resize"), GAP).not.toBeNull();
  // The Confirm button names where the bytes go, not the row's place ("Claude" here).
  expect(screen.getByRole("button", { name: "Confirm: send Wiring to LlamaCloud, pages 1-5" })).toBeTruthy();
});

test("red (slice 6 seam c): tray Activity reads the notice feed", async () => {
  const { Ledger } = await import("./ledger");
  const { LEDGER_PRESENTATIONS } = await import("./ledger-model");
  render(<Ledger presentation={LEDGER_PRESENTATIONS.tray} />);
  expect(screen.queryByText("Wiring"), GAP).not.toBeNull();
});

test("red (slice 6 seam c): the Mod+Shift+K overlay and its empty state read the notice feed", async () => {
  const { useLedgerList } = await import("./ledger");
  const { LEDGER_PRESENTATIONS } = await import("./ledger-model");
  let seen: { status: string; labels: string[] } | null = null;
  function Probe() {
    const ledger = useLedgerList(LEDGER_PRESENTATIONS.overlay);
    seen = {
      status: ledger.props.status,
      labels: ledger.props.items.map((item) => ledger.props.labelOf(item)),
    };
    return null;
  }
  render(<Probe />);
  // The feed answered, so the overlay is ready (its empty state is the feed's, not a pending join).
  expect(seen!.status, GAP).toBe("ready");
  expect(seen!.labels, GAP).toContain("Wiring");
});

test("a tier-save feed row exposes its stored receipt in the overlay DOM", async () => {
  const { noticeRows, SETTING_WRITE_PLACE } = await import("../../../host/src/notice-feed.ts");
  const { Ledger } = await import("./ledger");
  const { LEDGER_PRESENTATIONS } = await import("./ledger-model");
  const receipt = "165c9d43-0e40-457b-b4fa-53d2477964e9";
  const reason = `kaitp set 800 at ducts criteria.velocityLimitFpm.supply in the project home. Receipt ${receipt}.`;
  const before = feed.rows;
  feed.rows = noticeRows({ threads: [], receipts: [], works: [], machine: null, held: [], stored: [{
    class: "keep", place: SETTING_WRITE_PLACE, path: "project/Settings/ducts.json", sha256: "saved",
    at: new Date().toISOString(), reason,
  }] }, Date.now());
  try {
    render(<Ledger presentation={LEDGER_PRESENTATIONS.overlay} />);
    const row = screen.getByText("Setting saved").closest('[role="option"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain(receipt);
    const line = screen.getByText("Receipt " + receipt + ".");
    expect(line.classList.contains("whitespace-normal")).toBe(true);
    expect(line.classList.contains("break-all")).toBe(true);
    expect(line.classList.contains("face-mono")).toBe(true);
    expect(feed.rows[0]?.detail).toBe(`Receipt ${receipt}.`);
    expect(feed.rows[0]?.where).toBe("project/Settings/ducts.json");
  } finally {
    feed.rows = before;
  }
});
test("discard paths and harness stderr stay behind the overlay row tooltip", async () => {
  const { noticeRows } = await import("../../../host/src/notice-feed.ts");
  const { Ledger } = await import("./ledger");
  const { LEDGER_PRESENTATIONS } = await import("./ledger-model");
  const now = Date.now();
  const at = new Date(now).toISOString();
  const path = "C:/RAW-PATH-DETAIL/discard.json";
  const stderr = "[session/create] durationMs=79";
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const before = feed.rows;
  feed.rows = noticeRows({
    threads: [{
      id: "died", title: "Dead harness", providerName: "Claude", updatedAt: at, lastSeq: 1,
      activity: { state: "failed", pending: 0, lastSeq: 1, message: "The claude harness exited (code 3)." },
      lifecycle: { status: "active", explicitUnread: false, readSeq: 1 },
      events: [{
        kind: "error", seq: 1, at, turnId: "u1", message: "The claude harness exited (code 3).",
        failure: { kind: "other", message: "The claude harness exited (code 3).", raw: stderr },
      }],
    }] as unknown as Parameters<typeof noticeRows>[0]["threads"],
    receipts: [], works: [], machine: null, held: [],
    stored: [{ class: "discard", place: "Broken settings", path, sha256: "bad", at, reason: "Invalid JSON" }],
  }, now);
  try {
    render(<Ledger presentation={LEDGER_PRESENTATIONS.overlay} />);
    for (const [name, detail] of [["Broken settings", path], ["Dead harness", stderr]]) {
      const row = screen.getByText(name!).closest('[role="option"]');
      expect(row).not.toBeNull();
      expect(row!.textContent).not.toContain(detail);
      fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Copy the details" }));
      expect(writeText).toHaveBeenLastCalledWith(detail);
    }
  } finally {
    feed.rows = before;
  }
});
