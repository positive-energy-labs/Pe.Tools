// @vitest-environment jsdom
/**
 * Slice 6 falsifier, one notice feed (ADR 0035 rule 7): home Activity, tray Activity and the
 * Mod+Shift+K overlay draw the host's `notices` Reading as it is, with no browser join of thread
 * summaries, `actions.read` and Works. Every other source is dead here: a row can only come from
 * the feed.
 */
import type { NoticeFeed } from "@pe/agent-contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";

const feed: NoticeFeed = {
  id: 7,
  tray: false,
  rows: [
    {
      key: "thread:t1",
      group: "waits",
      revision: 1,
      verb: "approve",
      what: "Wiring",
      where: "Claude",
      says: "Delete the schedule",
      at: "2026-11-10T12:00:00.000Z",
      url: "/pea?thread=t1",
      act: { kind: "consent", threadId: "t1", requestId: "ask-1" },
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
