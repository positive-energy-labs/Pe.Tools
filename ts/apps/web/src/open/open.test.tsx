// @vitest-environment jsdom
/**
 * /open over the recorded machine: the launcher refuses before the press, an icon-started Revit
 * is reached by pid, hr shows only for a hot-reload shape, and Stop keeps work unless the Revit
 * is a checkout session.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { instancesRouteState, type Machine } from "@pe/agent-contracts";

import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { Launcher } from "./launcher";
import type { OpenHandle } from "./manifest";
import { EMPTY_DRAFT, launchPlan, modelRows, type LaunchDraft } from "./model";
import { RunningBlock, RunningList } from "./running";
import { BACKGROUND_BOOTING, CHECKOUT_HOT, MACHINE_SEEDS, OBSERVED_ICON, RECENTS } from "./seeds";

vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  readScopedActionStatuses: vi.fn(),
  runSemanticAction: vi.fn(async () => ({ id: "action-1", state: "succeeded" })),
}));
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const machine = (MACHINE_SEEDS["blocked-plan"] as { observation: Machine }).observation;
const rows = modelRows(machine.revit.sessions!, RECENTS.result.recents);
const row = (title: string) => rows.find((candidate) => candidate.title === title)!.key;
const key = { binding: "workspace" as const, route: "instances", target: null, work: "instances" };
const basis = { key, revision: 7 };

describe("launch plan", () => {
  test("a file saved in a newer Revit is refused in every installed year", () => {
    const plan = launchPlan({ ...EMPTY_DRAFT, doc: row("Pier 9 Annex.rvt") }, machine, rows);
    expect(plan.year).toBe(2026);
    expect(plan.refusal).toBe(
      "Pier 9 Annex.rvt was saved in Revit 2027; Revit 2026 cannot open a newer file.",
    );
  });

  test("a document open in another Revit is refused and names that Revit's pid", () => {
    const plan = launchPlan({ ...EMPTY_DRAFT, doc: row("project-a Tower.rvt") }, machine, rows);
    expect(plan.refusal).toBe("project-a Tower.rvt is already open in Revit 2025 (pid 2501).");
  });

  test("a booting Revit opens nothing; an older file warns that opening upgrades it", () => {
    const booting = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Riverside MEP.rvt"), year: 2026, target: "pe-app-26-installed" },
      machine,
      rows,
    );
    expect(booting.refusal).toContain("is booting; it opens nothing until it answers");
    expect(booting.caution).toContain("Opening in 2026 upgrades it");
  });

  test("a non-default shape prints two commands and says why", () => {
    const plan = launchPlan(
      {
        ...EMPTY_DRAFT,
        doc: row("Riverside MEP.rvt"),
        target: "new",
        posture: "background",
        quarantine: true,
      },
      machine,
      rows,
    );
    expect(plan.argv).toEqual([
      "pe-revit session start --year 2024 --background --quarantine",
      'pe-revit doc open "C:\\Models\\Riverside MEP.rvt" --id <minted> --conflict keep --links refuse',
    ]);
    expect(plan.note).toContain("two commands");
    expect(plan.launch).toMatchObject({ kind: "start", posture: "background", quarantine: true });
  });
});

function handleWith(write = vi.fn(async (_patches: unknown, _revision?: number) => null)) {
  return {
    work: {
      key,
      revision: 7,
      current: true,
      write,
      doc: instancesRouteState.schema.parse({}),
    },
    note: vi.fn(),
  } as unknown as OpenHandle;
}

function Harness({ handle, initial }: { handle: OpenHandle; initial: LaunchDraft }) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <Launcher
        handle={handle}
        machine={machine}
        rows={rows}
        draft={draft}
        setDraft={setDraft}
        fixture={false}
      />
      <RunningList
        sessions={machine.revit.sessions}
        loading={false}
        basis={basis}
        refusal={null}
        onHere={(session) =>
          setDraft({
            ...draft,
            year: session.row.year,
            target:
              session.row.case === "observed-active"
                ? `pid:${session.row.process.pid}`
                : session.row.id,
          })
        }
      />
    </>
  );
}

test("Open here on an icon-started Revit stages and dispatches by pid", async () => {
  const write = vi.fn(async (_patches: unknown, _revision?: number) => null);
  const handle = handleWith(write);
  render(<Harness handle={handle} initial={{ ...EMPTY_DRAFT, doc: row("Riverside MEP.rvt") }} />);
  const observed = screen.getByRole("region", { name: "Revit 2024 started from the Revit icon" });
  fireEvent.click(within(observed).getByRole("button", { name: "open here" }));
  const launch = await screen.findByRole("button", { name: "Open in Revit 2024" });
  expect(document.querySelector("[data-argv]")!.textContent).toContain("--pid 2402");
  fireEvent.click(launch);
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  expect(write.mock.calls[0]![1]).toBe(7);
  expect(JSON.stringify(write.mock.calls[0]![0])).toContain('"pid":2402');
  expect(vi.mocked(runSemanticAction).mock.calls[0]!.slice(0, 4)).toEqual([
    "instances.open",
    {
      workspaceId: "instances",
      session: {
        selection: { pid: 2402 },
        process: (OBSERVED_ICON.row as { process: unknown }).process,
      },
    },
    undefined,
    { work: { key, revision: 8 } },
  ]);
});

test("hr is drawn only for a hot-reload shape", () => {
  render(<RunningBlock session={CHECKOUT_HOT} basis={basis} refusal={null} onHere={() => {}} />);
  expect(screen.queryByRole("button", { name: "hr" })).not.toBeNull();
  cleanup();
  for (const session of [OBSERVED_ICON, BACKGROUND_BOOTING]) {
    render(<RunningBlock session={session} basis={basis} refusal={null} onHere={() => {}} />);
    expect(screen.queryByRole("button", { name: "hr" })).toBeNull();
    cleanup();
  }
});

test("Stop keeps work by default; discard is offered only for a checkout session", async () => {
  render(<RunningBlock session={OBSERVED_ICON} basis={basis} refusal={null} onHere={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  expect(screen.queryByRole("button", { name: "stop, discard edits" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "stop, keep work" }));
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  const [action, input] = vi.mocked(runSemanticAction).mock.calls[0]!;
  expect(action).toBe("instances.stop");
  expect(input).toMatchObject({
    session: { selection: { pid: 2402 } },
    unsaved: "keep",
    force: false,
  });
  cleanup();
  render(<RunningBlock session={CHECKOUT_HOT} basis={basis} refusal={null} onHere={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  expect(screen.queryByRole("button", { name: "stop, discard edits" })).not.toBeNull();
});
