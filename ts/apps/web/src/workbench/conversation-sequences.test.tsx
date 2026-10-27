// @vitest-environment jsdom
import { harnessEventSchema } from "@pe/agent-contracts";
import type { ChatMessage } from "@pe/agent-contracts/chat-state";
import { emptyChatState, selectMessages } from "@pe/agent-contracts/chat-state";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { type CallPart } from "./conversation-sequences";
import { Moments } from "./moments";

const wire = vi.hoisted(() => ({
  pin: null as string | null,
  setPin: vi.fn(),
  feedback: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@effect/atom-react", async (original) => {
  const actual = await original<typeof import("@effect/atom-react")>();
  return {
    ...actual,
    useAtomValue: (atom: Parameters<typeof actual.useAtomValue>[0]) =>
      atom === null ? wire.pin : actual.useAtomValue(atom),
  };
});
vi.mock("./thread-view", () => ({
  useCurrentThreadView: () => ({
    atoms: { openCallKey: null },
    actions: { setOpenCallKey: wire.setPin },
  }),
}));
vi.mock("#/components/feedback-picker", () => ({ startFeedback: wire.feedback }));
vi.mock("@pe/kit/lib/use-copy", () => ({
  useCopy: () => ({ copied: false, copy: wire.copy }),
}));
// The record classifier and route are separate owners; this checks that folding retains their outputs.
vi.mock("./chat-plugins", () => ({
  proposedRecord: (title: string) =>
    title === "propose" ? { route: "schedules", changes: 2, subject: "Model" } : null,
  actionCall: (title: string) =>
    title === "apply" ? { id: "receipt-1", key: "schedule.apply" } : null,
}));
vi.mock("./record-lines", () => ({
  ProposedLine: () => <div data-proposed="schedules">2 changes · open proposal</div>,
  ActionLine: () => <div data-action="receipt-1">action receipt · inspect</div>,
}));
vi.mock("./thumbnail", () => ({
  Thumbnail: ({ src }: { src: string }) => <img src={src} alt="capture" />,
}));
vi.mock("@pe/kit/lang/code", () => ({
  Code: ({ code, title }: { code: string; title?: string }) => <pre aria-label={title}>{code}</pre>,
  stringify: (value: unknown) => JSON.stringify(value),
}));

const call = (
  id: string,
  title = "read",
  status: "completed" | "in_progress" = "completed",
): CallPart => ({
  type: "tool-call",
  call: { id, title, status, args: {}, images: [], caption: `Latest ${id}` },
});
const message = (
  id: string,
  parts: ChatMessage["parts"],
  role: ChatMessage["role"] = "assistant",
): ChatMessage => ({
  id,
  role,
  parts,
  running: false,
  createdAt: new Date("2026-10-12T12:00:00Z"),
});
const show = (messages: ChatMessage[]) =>
  render(<Moments messages={messages} register={() => {}} harness="claude" />);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  wire.pin = null;
  vi.clearAllMocks();
});

test("a classified turn error survives the event projection and discloses its raw body", () => {
  const failure = {
    kind: "billing",
    message: "billing: Out of credit or billing limit reached.",
    raw: '{"error":{"type":"insufficient_quota"}}',
  };
  const event = harnessEventSchema.parse({
    seq: 1,
    at: "2026-10-12T12:00:00Z",
    kind: "error",
    turnId: "turn",
    message: failure.message,
    failure,
  });
  show(selectMessages({ ...emptyChatState(), events: [event] }));
  expect(screen.getByText(failure.message)).toBeTruthy();
  expect(screen.queryByText(failure.raw)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Raw error" }));
  expect(screen.getByText(failure.raw)).toBeTruthy();
});

test("folding leaves images, diagrams, proposals, receipts and waiting records visible outside details", () => {
  const image = call("image");
  image.call.images = ["data:image/png;base64,AA=="];
  const diagram = call("diagram", "diagram");
  diagram.call.args = { title: "Inspect diagram", nodes: [{ id: "A", label: "A" }], edges: [] };
  diagram.call.result = { ok: true };
  const pending = {
    ...call("ask", "apply", "in_progress"),
    approval: { requestId: "r", toolCallId: "ask", toolName: "apply", options: [] },
  };
  const screen = show([
    message("a", [image, diagram]),
    message("b", [call("proposal", "propose"), call("receipt", "apply"), pending]),
  ]);
  const details = screen.container.querySelector("details")!;
  expect(screen.container.querySelectorAll("details")).toHaveLength(1);
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toContain("5 tools");
  for (const node of [
    screen.getByAltText("capture"),
    screen.getByLabelText("Inspect diagram"),
    screen.getByText("2 changes · open proposal"),
    ...screen.getAllByText("action receipt · inspect"),
    screen.getByText("waiting"),
  ]) {
    expect(node.closest("details")).toBeNull();
  }
  // The image sits at the group's foot, below the later calls' records and the live ask.
  const records = screen.container.querySelector("[data-tool-records]")!;
  expect(records.lastElementChild?.contains(screen.getByAltText("capture"))).toBe(true);
  expect(screen.container.querySelector(".dl-message-controls")).toBeNull();
});
