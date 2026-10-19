// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { Moments } from "./moments";
import { transcriptSegments, type CallPart, type Segment } from "./conversation-sequences";
import type { ChatMessage } from "@pe/agent-contracts/chat-state";
import { emptyChatState, selectMessages } from "@pe/agent-contracts/chat-state";
import { harnessEventSchema } from "@pe/agent-contracts";

const wire = vi.hoisted(() => ({
  pin: null as string | null,
  setPin: vi.fn(),
  feedback: vi.fn(),
  copy: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => wire.pin }));
vi.mock("./thread-view", () => ({
  useCurrentThreadView: () => ({
    atoms: { openCallKey: null },
    actions: { setOpenCallKey: wire.setPin },
  }),
}));
vi.mock("#/components/feedback-picker", () => ({ startFeedback: wire.feedback }));
vi.mock("@pe/kit/lib/use-copy", () => ({ useCopy: () => ({ copied: false, copy: wire.copy }) }));
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
const thought = (text: string): ChatMessage["parts"][number] => ({ type: "reasoning", text });
const shape = (segments: Segment[]) =>
  segments.map((segment) =>
    "run" in segment
      ? segment.run.map((part) => (part.type === "tool-call" ? part.call.id : part.text))
      : "prose",
  );
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

test("live, approval and record calls stay in one maximal sequence, while agent prose interrupts it", () => {
  const approval = { requestId: "request-1", toolCallId: "b", toolName: "apply", options: [] };
  const first = message("first", [call("a"), { ...call("b", "apply", "in_progress"), approval }]);
  const second = message("second", [call("c", "propose")]);
  const response = message("response", [{ type: "text", text: "Here is the plan." }]);
  const last = message("last", [call("d")]);
  const runs = transcriptSegments([first, second, response, last]);
  expect(shape(runs.get("first")!)).toEqual([["a", "b", "c"]]);
  expect(runs.get("second")).toEqual([]);
  expect(runs.get("response")).toHaveLength(1);
  expect(runs.get("last")).toHaveLength(1);
  const groups = transcriptSegments([
    message("mixed", [
      call("a"),
      { ...call("b"), approval },
      { type: "text", text: "Answer" },
      call("c", "read", "in_progress"),
    ]),
  ]).get("mixed")!;
  expect(shape(groups)).toEqual([["a", "b"], "prose", ["c"]]);
});

test("a thought between calls stays in the run, and agent prose breaks it", () => {
  const runs = transcriptSegments([
    message("a", [call("a"), thought("hmm"), call("b")]),
    message("b", [thought("again"), call("c"), { type: "text", text: "Prose." }, thought("late")]),
  ]);
  // The run crosses the message boundary; "b" holds only what prose leaves after it.
  expect(shape(runs.get("a")!)).toEqual([["a", "hmm", "b", "again", "c"]]);
  expect(shape(runs.get("b")!)).toEqual(["prose", ["late"]]);
});

test("one fold counts tools and thoughts, opens them in order, and reserves no hover space", () => {
  const screen = show([
    message("a", [call("a"), thought("first thought"), call("b"), thought("second thought")]),
  ]);
  const summaries = screen.container.querySelectorAll("summary");
  expect(summaries).toHaveLength(1);
  expect(summaries[0]!.textContent).toContain("2 tools · 2 thoughts");
  const body = screen.container.querySelector("details")!;
  expect(
    [...body.querySelectorAll("[data-tool-id], button")].map(
      (el) => el.getAttribute("data-tool-id") ?? el.textContent,
    ),
  ).toEqual(["a", "Thought process", "b", "Thought process"]);
  expect(screen.container.querySelector(".dl-message-controls")).toBeNull();
});

test("a thought with no call stays a plain disclosure, not a fold", () => {
  const screen = show([message("a", [thought("alone"), { type: "text", text: "Answer." }])]);
  expect(screen.container.querySelector("details")).toBeNull();
  expect(screen.getByRole("button", { name: "Thought process" })).toBeTruthy();
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
  expect(screen.container.querySelector(".dl-message-controls")).toBeNull();
});

test("trailing and leading calls join across prose-bearing message boundaries", () => {
  const screen = show([
    message("first", [{ type: "text", text: "Checking." }, call("a")]),
    message("second", [
      call("b", "read", "in_progress"),
      { type: "text", text: "Answer." },
      call("c"),
    ]),
    message("third", [call("d")]),
  ]);
  const summaries = [...screen.container.querySelectorAll("summary")];
  expect(summaries).toHaveLength(2);
  expect(summaries.map((summary) => summary.textContent)).toEqual([
    expect.stringContaining("2 tools"),
    expect.stringContaining("2 tools"),
  ]);
  expect(screen.getByText("Checking.")).toBeTruthy();
  expect(screen.getByText("Answer.")).toBeTruthy();
});

test("latest call updates carry a separate activity signal, and failures remain visible while another call runs", async () => {
  vi.useFakeTimers();
  const first = message("a", [call("first")]);
  const screen = show([first]);
  const failed: CallPart = {
    type: "tool-call",
    call: { id: "failed", title: "read", args: {}, images: [], status: "failed", error: "Error" },
  };
  screen.rerender(
    <Moments
      messages={[message("a", [...first.parts, failed, call("latest", "read", "in_progress")])]}
      register={() => {}}
      harness="claude"
    />,
  );
  const summary = screen.container.querySelector("summary")!;
  expect(summary.hasAttribute("data-new-call")).toBe(true);
  expect(summary.textContent).toContain("Latest latest");
  expect(summary.textContent).toContain("1 failed");
  expect(summary.textContent).toContain("Running");
  await act(() => vi.advanceTimersByTimeAsync(1400));
  expect(summary.hasAttribute("data-new-call")).toBe(false);
});

test("an opened call opens its sequence and shows its input and output", () => {
  wire.pin = "tool:two";
  const second = call("two");
  second.call.result = { exact: "output" };
  const screen = show([message("one", [call("one")]), message("two", [second])]);
  expect(screen.container.querySelector("details")?.open).toBe(true);
  expect(screen.getByLabelText("out").textContent).toContain("output");
  fireEvent.click(
    screen.container.querySelector('[data-tool-id="two"] [data-annotation="tool-marker"]')!,
  );
  expect(wire.setPin).toHaveBeenCalledWith(null);
});

test("normal-message controls sit after content, copy only markdown and target the real feedback picker", () => {
  const screen = show([message("answer", [{ type: "text", text: "**Answer**" }])]);
  const section = screen.container.querySelector("section")!;
  expect(section.lastElementChild?.className).toBe("dl-message-controls");
  expect(section.querySelector("h2 time")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect(wire.copy).toHaveBeenCalledWith("**Answer**");
  fireEvent.click(screen.getByRole("button", { name: "Feedback about this message" }));
  expect(wire.feedback).toHaveBeenCalledWith(section);
  expect(screen.queryByRole("button", { name: /fork/i })).toBeNull();
});

test("a sent PDF's name opens it in the browser through a blob URL", () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const create = vi.fn((_blob: Blob) => "blob:http://pe/submittal");
  URL.createObjectURL = create;
  URL.revokeObjectURL = vi.fn();
  const sent = message(
    "you-2",
    [
      {
        type: "file",
        name: "damper.pdf",
        mimeType: "application/pdf",
        size: 9,
        data: "JVBERi0xLjcK",
      },
    ],
    "user",
  );
  fireEvent.click(show([sent]).getByRole("button", { name: "Open damper.pdf" }));
  const blob = create.mock.calls[0]![0];
  expect(blob.type).toBe("application/pdf");
  expect(blob.size).toBe(9);
  expect(open).toHaveBeenCalledWith("blob:http://pe/submittal", "_blank", "noopener");
});

test("a user turn draws its sent files, and a slash prompt draws the skill as a chip", () => {
  const sent = message(
    "you-1",
    [
      { type: "image", image: "data:image/png;base64,AAAA", name: "riser.png" },
      { type: "file", name: "duct-sizes.csv", mimeType: "text/csv", size: 1536 },
      { type: "text", text: "/review-schedule Mechanical Equipment" },
    ],
    "user",
  );
  const screen = show([sent]);
  expect(screen.getByAltText("capture")).toBeTruthy();
  expect(
    screen.getByText("duct-sizes.csv").closest("[data-base-ui-tooltip-trigger]")!.textContent,
  ).toBe("duct-sizes.csv1.5 KB");
  const bubble = screen.container.querySelector(".dl-message-bubble")!;
  expect(bubble.querySelector("[data-surface=artifact]")?.textContent).toBe("/review-schedule");
  expect(bubble.textContent).toContain("Mechanical Equipment");
  fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
  expect(wire.copy).toHaveBeenCalledWith("/review-schedule Mechanical Equipment");
});
