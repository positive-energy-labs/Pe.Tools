// @vitest-environment jsdom
/** The document ladder never writes a pin by itself: no lone-document bind, no lost-pin rebind. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { MACHINE_SEEDS, CHECKOUT_HOT } from "#/open/seeds";

vi.mock("#/machine/use-machine", () => ({
  useMachineSlice: (select: (reading: { state: "absent" }) => unknown) =>
    select({ state: "absent" }),
}));
const choose = vi.fn();
vi.mock("#/route/shell", () => ({ useChooseTarget: () => [null, choose] }));
const { useDocumentLadder, LadderPicker } = await import("./situation-ladder");

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
  const ladder = useDocumentLadder({
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
  } as never);
  return <LadderPicker ladder={ladder} />;
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
