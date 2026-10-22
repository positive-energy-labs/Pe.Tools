// @vitest-environment jsdom
/** The document ladder binds the lone document by itself and keeps asking when there are several. */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { MACHINE_SEEDS, CHECKOUT_HOT } from "#/open/seeds";

vi.mock("#/machine/use-machine", () => ({ useMachine: () => ({ reading: { state: "absent" } }) }));
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

test("one session with one document is bound without a pick", () => {
  render(<Probe docs={["a"]} />);
  expect(choose).toHaveBeenCalledTimes(1);
  expect(JSON.parse(choose.mock.calls[0]![0])).toMatchObject({
    kind: "open",
    ref: { openId: "a" },
  });
});

test("several documents keep asking", () => {
  render(<Probe docs={["a", "b"]} />);
  expect(choose).not.toHaveBeenCalled();
  expect(screen.queryByText(/only open document/)).toBeNull();
});

test("a lost binding is rebound only to the same title reopened (a Revit restart)", () => {
  render(<Probe docs={["a"]} lost={{ title: "a" }} />);
  expect(choose).toHaveBeenCalledTimes(1);
  cleanup();
  choose.mockReset();
  render(<Probe docs={["b"]} lost={{ title: "a" }} />);
  expect(choose).not.toHaveBeenCalled();
});

test("a binding whose session is gone and whose title was never seen rebinds the one open document; a closed document does not", () => {
  render(<Probe docs={["a"]} lost={{ title: null }} />);
  expect(choose).toHaveBeenCalledTimes(1);
  cleanup();
  choose.mockReset();
  render(<Probe docs={["a"]} lost={{ title: null, reason: "document-closed" }} />);
  expect(choose).not.toHaveBeenCalled();
});
