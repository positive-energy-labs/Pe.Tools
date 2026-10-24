// @vitest-environment jsdom
import type { TurnElementNamesObservation, TurnElementNamesRequest } from "@pe/agent-contracts";
import type { ChatMessage } from "@pe/agent-contracts/chat-state";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Moments } from "./moments";
import { forgetTurnNames } from "./turn-names";

const host = vi.hoisted(() => ({
  read: vi.fn<(body: TurnElementNamesRequest) => Promise<TurnElementNamesObservation>>(),
}));
vi.mock("./provider/harness-client", () => ({
  harnessClient: () => ({ turnElementNames: host.read }),
}));
vi.mock("./config", () => ({ resolveWorkbenchConfig: () => ({ origin: "http://127.0.0.1" }) }));
vi.mock("./thread-view", () => ({
  useCurrentThreadView: () => ({ atoms: { openCallKey: null }, actions: {} }),
}));

const target = { session: "s", openId: "o1" };
const observation = (
  entries: TurnElementNamesObservation["entries"],
  complete = true,
): TurnElementNamesObservation => ({
  snapshot: { thread: "th", turnId: "t1", targets: [target], complete },
  observedAt: "2026-10-24T12:00:00.000Z",
  entries,
});
const ENTRIES: TurnElementNamesObservation["entries"] = [
  { state: "resolved", elementId: 101, target, uniqueId: "u-101", name: "FR-1" },
  { state: "ambiguous", elementId: 102 },
  { state: "unresolved", elementId: 103, reason: "missing" },
];
const row = (id: string, text: string, running = false): ChatMessage => ({
  id,
  role: "assistant",
  turnId: "t1",
  parts: [{ type: "text", text }],
  running,
  createdAt: new Date("2026-10-24T12:00:00Z"),
});
const TURN = [row("pea-1", "Open end at 101 and 102."), row("pea-2", "Also 103, not `101`.")];
const show = (messages: ChatMessage[]) =>
  render(<Moments messages={messages} register={() => {}} harness="claude" thread="th" />);
const settle = () => act(async () => {});
afterEach(() => {
  cleanup();
  forgetTurnNames();
  vi.clearAllMocks();
});

test("one read per settled turn, batched across its rows, never again on re-render or remount", async () => {
  host.read.mockResolvedValue(observation(ENTRIES));
  const view = show([row("pea-1", "Open end at 101", true)]);
  await settle();
  expect(host.read).not.toHaveBeenCalled();
  view.rerender(<Moments messages={TURN} register={() => {}} harness="claude" thread="th" />);
  await settle();
  expect(host.read).toHaveBeenCalledTimes(1);
  expect(host.read).toHaveBeenCalledWith({
    kind: "turn-element-names",
    thread: "th",
    turnId: "t1",
    ids: [101, 102, 103],
  });
  view.rerender(<Moments messages={[...TURN]} register={() => {}} harness="claude" thread="th" />);
  view.unmount();
  show(TURN);
  await settle();
  expect(host.read).toHaveBeenCalledTimes(1);
});

test("only an id resolved to one element links, through attention, in its pinned document", async () => {
  host.read.mockResolvedValue(observation(ENTRIES));
  const view = show(TURN);
  await settle();
  const links = [...view.container.querySelectorAll(".subject-ref")];
  expect(
    links.map((link) => [link.getAttribute("data-subject"), link.getAttribute("data-subject-doc")]),
  ).toEqual([["e:101", "s/o1"]]);
  expect(links[0]!.textContent).toBe("FR-11");
  // Ambiguous and unresolved ids are plain text; the code span keeps its literal id.
  expect(view.container.textContent).toContain("and 102.");
  expect(view.container.textContent).toContain("Also 103, not 101.");
  expect(view.container.querySelector("code")!.textContent).toBe("101");
  expect(view.container.querySelectorAll("[href^='pe:']")).toHaveLength(0);
});

test("an incomplete snapshot or a failed read leaves every id plain", async () => {
  host.read.mockResolvedValueOnce(observation(ENTRIES, false));
  const incomplete = show(TURN);
  await settle();
  expect(incomplete.container.querySelectorAll(".subject-ref")).toHaveLength(0);
  expect(incomplete.container.textContent).toContain("Open end at 101 and 102.");
  incomplete.unmount();
  forgetTurnNames();
  host.read.mockRejectedValueOnce(new Error("404"));
  const failed = show(TURN);
  await settle();
  expect(failed.container.querySelectorAll(".subject-ref")).toHaveLength(0);
  expect(host.read).toHaveBeenCalledTimes(2);
});
