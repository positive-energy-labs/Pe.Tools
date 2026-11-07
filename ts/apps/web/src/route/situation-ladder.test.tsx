// @vitest-environment jsdom
/** The document ladder never writes a pin by itself: no lone-document bind, no lost-pin rebind. */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { discoveryMachine, readingKey, READING_MAX_FRAME_BYTES } from "@pe/agent-contracts";
import { resourceResponse } from "../../../../packages/runtime/src/resource-stream.ts";
import { machineFixture } from "../../../../packages/agent-contracts/tests/machine-fixture.ts";
import { MACHINE_SEEDS, CHECKOUT_HOT } from "#/design-system/open-examples";

vi.mock("#/machine/use-machine", () => ({
  useMachineSlice: (select: (reading: { state: "absent" }) => unknown) =>
    select({ state: "absent" }),
}));
const choose = vi.fn();
vi.mock("#/shell/binding", () => ({ useChooseTarget: () => [null, choose] }));
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

function CensusProbe({ machine }: { machine: unknown }) {
  const picked = useDocumentLadder({
    readings: { machine: { state: "ready", observation: machine } },
    resolution: { kind: "none" },
    bindingLost: null,
  } as never);
  ladder = picked;
  return <LadderPicker ladder={picked} />;
}

function holdingsMachine() {
  const machine = machineFixture([
    { session: "large", documents: [] },
    { session: "healthy", documents: [] },
  ]);
  Object.assign(machine.revit.sessions![0]!, {
    holdings: [
      {
        openId: "doc",
        title: "Large model",
        holdings: {
          elements: Array.from({ length: 100000 }, (_, id) => ({
            id,
            category: "Ducts",
            name: "HELD_ELEMENT_SENTINEL",
            changedSinceSync: null,
            requesters: [],
          })),
          empty: false,
          savedNotSynced: null,
          unsaved: false,
          worksets: [],
          workshared: true,
        },
      },
    ],
    holdingsLeg: {
      observedAtUtc: machine.observedAtUtc,
      attemptedAtUtc: machine.observedAtUtc,
      error: null,
    },
  });
  return machine;
}

test("100k holdings cross the actual frame boundary as counts and every session remains in the picker", async () => {
  const value = discoveryMachine(holdingsMachine());
  const response = resourceResponse(
    new Request(
      `http://localhost/pe/resources?keys=${encodeURIComponent(JSON.stringify([{ kind: "machine" }]))}`,
    ),
    (_request, publish) => {
      publish({ kind: "snapshot", key: readingKey(_request), value });
      return () => {};
    },
  );
  const reader = response.body!.getReader();
  try {
    const chunk = (await reader.read()).value!;
    expect(chunk.byteLength).toBeLessThan(READING_MAX_FRAME_BYTES);
    const wire = new TextDecoder().decode(chunk);
    expect(wire).not.toContain("HELD_ELEMENT_SENTINEL");
    const frame = JSON.parse(wire.split("data: ")[1]!.trim());
    expect(frame.kind).toBe("snapshot");
    expect(frame.value.revit.sessions[0].holdings[0].holdings.elementCount).toBe(100000);
    render(<CensusProbe machine={frame.value} />);
    expect(ladder!.levels[0]!.options!.map((o) => o.id)).toEqual(["large", "healthy"]);
  } finally {
    await reader.cancel();
  }
});

test.each(["oversized", "unserializable"])(
  "a %s summary degrades only its session and the picker gives a named way out",
  (failure) => {
    const machine = holdingsMachine();
    Object.assign(machine.revit.sessions![0]!.holdings![0]!, {
      title: failure === "oversized" ? "x".repeat(READING_MAX_FRAME_BYTES) : 1n,
    });
    const value = discoveryMachine(machine);
    expect(value.revit.sessions![0]!.holdings).toBeNull();
    expect(value.revit.sessions![1]!.holdingsLeg.error).toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBeLessThan(
      READING_MAX_FRAME_BYTES,
    );
    render(<CensusProbe machine={value} />);
    expect(ladder!.levels[0]!.options).toHaveLength(2);
    expect(ladder!.levels[0]!.options![0]!.sub).toMatch(
      /session sdk-0: holdings too large.*Choose another session/,
    );
  },
);
