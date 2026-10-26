// @vitest-environment jsdom
/** The document ladder never writes a pin by itself: no lone-document bind, no lost-pin rebind. */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { MACHINE_SEEDS, CHECKOUT_HOT } from "#/open/seeds";

vi.mock("#/machine/use-machine", () => ({
  useMachineSlice: (select: (reading: { state: "absent" }) => unknown) =>
    select({ state: "absent" }),
}));
const choose = vi.fn();
vi.mock("#/route/shell", () => ({ useChooseTarget: () => [null, choose] }));
const call = vi.hoisted(() => vi.fn());
vi.mock("#/host/pe-client", () => ({ peClient: { call } }));
const { useDocumentLadder, LadderPicker } = await import("./situation-ladder");
let ladder: ReturnType<typeof useDocumentLadder> | null = null;

afterEach(() => {
  cleanup();
  choose.mockReset();
});

const doc = (openId: string) => ({ ...CHECKOUT_HOT.documents![0]!, openId, title: openId });
function Probe({
  docs,
  lost,
}: {
  docs: string[];
  lost?: { title: string | null; reason?: string };
}) {
  const seed = MACHINE_SEEDS["no-revit"];
  if (seed.state !== "ready") throw new Error("fixture must be ready");
  const reading = {
    ...seed,
    observation: {
      ...seed.observation,
      revit: {
        ...seed.observation.revit,
        sessions: [
          {
            ...CHECKOUT_HOT,
            attachment: { ...CHECKOUT_HOT.attachment, documents: docs.map(doc) },
            documents: docs.map(doc),
          },
        ],
      },
    },
  };
  const picked = useDocumentLadder({
    readings: { machine: reading },
    resolution: { kind: "none" },
    bindingLost: lost
      ? {
          ref: { session: "old", openId: "old" },
          title: lost.title,
          sentence: "",
          reason: lost.reason ?? "session-gone",
          reopened: null,
        }
      : null,
    thread: "T",
  } as never);
  ladder = picked;
  return <LadderPicker ladder={picked} />;
}

test("one session with one document writes no pin: the sole document is a read-only fallback", () => {
  render(<Probe docs={["a"]} />);
  expect(choose).not.toHaveBeenCalled();
});

test("several documents keep asking", () => {
  render(<Probe docs={["a", "b"]} />);
  expect(choose).not.toHaveBeenCalled();
  expect(screen.queryByText(/only open document/)).toBeNull();
});

test("a closed explicit pin is never rebound, even to a sole document with the same title", () => {
  render(<Probe docs={["a"]} lost={{ title: "a", reason: "document-closed" }} />);
  expect(choose).not.toHaveBeenCalled();
  cleanup();
  render(<Probe docs={["a"]} lost={{ title: null, reason: "session-gone" }} />);
  expect(choose).not.toHaveBeenCalled();
});

test("a person's pick in a tool with a chat selected writes only that tool's ?target", () => {
  render(<Probe docs={["a", "b"]} />);
  const session = ladder!.levels[0]!;
  act(() => session.pick(session.options![0]!.id));
  act(() => ladder!.levels[1]!.pick("b"));
  expect(choose).toHaveBeenCalledTimes(1);
  expect(JSON.parse(choose.mock.calls[0]![0])).toMatchObject({
    kind: "open",
    ref: { openId: "b" },
  });
  // Pushed (a named move), and no thread-head or target call reaches the host.
  expect(choose.mock.calls[0]![1]).toBeUndefined();
  expect(call).not.toHaveBeenCalled();
});
