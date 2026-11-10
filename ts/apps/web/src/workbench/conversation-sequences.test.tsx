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
  renders: [] as string[],
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
  ProposedLine: () => <div data-proposed="schedules">2 changes · open suggestion</div>,
  ActionLine: () => <div data-action="receipt-1">action receipt · inspect</div>,
}));
vi.mock("./prose", async (original) => ({
  ...(await original<typeof import("./prose")>()),
  Markdown: ({ text }: { text: string }) => {
    wire.renders.push("text");
    return <p>{text}</p>;
  },
}));
vi.mock("#/components/lang/conversation", async (original) => {
  const actual = await original<typeof import("#/components/lang/conversation")>();
  return {
    ...actual,
    ToolStatus: (props: Parameters<typeof actual.ToolStatus>[0]) => {
      wire.renders.push("tool");
      return <actual.ToolStatus {...props} />;
    },
  };
});
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
    message("b", [call("suggestion", "propose"), call("receipt", "apply"), pending]),
  ]);
  const details = screen.container.querySelector("details")!;
  expect(screen.container.querySelectorAll("details")).toHaveLength(1);
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toContain("5 tools");
  for (const node of [
    screen.getByAltText("capture"),
    screen.getByLabelText("Inspect diagram"),
    screen.getByText("2 changes · open suggestion"),
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

test("a failed call speaks once in its run's row: one toned glyph, a count, its label once", () => {
  const failed = call("restart", "pe_do");
  Object.assign(failed.call, { status: "failed", error: "no session", caption: "restart session" });
  const screen = show([message("a", [call("one"), failed, call("three")])]);
  const summary = screen.container.querySelector("summary")!;
  expect(summary.textContent).toContain("3 tools · 1 failed");
  expect(summary.textContent!.split("restart session")).toHaveLength(2);
  expect([...summary.querySelectorAll("[data-tone]")].map((node) => node.tagName)).toEqual([
    "svg",
  ]);
});

test("one streamed entry renders once at N=10 and N=200, including equal-length text changes", () => {
  const counts: number[] = [];
  const register = () => {};
  for (const n of [10, 200]) {
    const messages = Array.from({ length: n }, (_, index) =>
      message(`settled-${index}`, [{ type: "text", text: `settled ${index}` }], "user"),
    );
    const moving = message("streaming", [
      ...Array.from({ length: n }, (_, index) => call(`call-${index}`)),
      { type: "text", text: "alpha" },
    ]);
    moving.running = true;
    messages.push(moving);
    const view = render(<Moments messages={messages} register={register} harness="claude" />);
    wire.renders.length = 0;
    // Refolding recreates every entry; ids and settled content stay the same.
    const next = messages.map((message) => ({
      ...structuredClone(message),
      createdAt: message.createdAt ? new Date(message.createdAt.getTime()) : undefined,
    }));
    expect(next[0].createdAt).not.toBe(messages[0].createdAt);
    next.at(-1)!.parts[n] = { type: "text", text: "bravo" };
    view.rerender(<Moments messages={next} register={register} harness="claude" />);
    expect(view.getByText("bravo")).toBeTruthy();
    expect(wire.renders).toEqual(["text"]);
    counts.push(wire.renders.length);
    fireEvent.click(view.getAllByRole("button", { name: "Copy message" }).at(-1)!);
    expect(wire.copy).toHaveBeenLastCalledWith("bravo");
    view.unmount();
  }
  expect(counts).toEqual([1, 1]);
});
