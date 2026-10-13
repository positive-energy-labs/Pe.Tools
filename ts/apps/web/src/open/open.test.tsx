// @vitest-environment jsdom
/**
 * /open over the recorded machine: the launcher refuses before the press, an icon-started Revit
 * is reached by pid, hr shows only for a hot-reload shape, and Stop keeps work unless the Revit
 * is a checkout session.
 */
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { type Machine, type MachineSession } from "@pe/agent-contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";

import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { Launcher } from "./launcher";
import { runLifecycle } from "./lifecycle";
import type { OpenHandle } from "./manifest";
import { EMPTY_DRAFT, launchPlan, modelRows, type DocRow, type LaunchDraft } from "./model";
import { RunningList, RunningSession } from "./running";
import { OpenPage } from "./route";
import { BACKGROUND_BOOTING, CHECKOUT_HOT, MACHINE_SEEDS, OBSERVED_ICON, RECENTS } from "./seeds";

vi.mock("../../../../packages/mcps/src/shared/takeoff-action-client", () => ({
  readScopedActionStatuses: vi.fn(),
  runSemanticAction: vi.fn(async () => ({ id: "action-1", state: "succeeded" })),
}));
HTMLElement.prototype.scrollIntoView = vi.fn();
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const machine = (MACHINE_SEEDS["blocked-plan"] as { observation: Machine }).observation;
const rows = modelRows(machine.revit.sessions!, RECENTS.result.recents);
const row = (title: string) => rows.find((candidate) => candidate.title === title)!.key;

test("the frozen Open route renders and drafts without opening a host transport", async () => {
  const transports: string[] = [];
  class Source {
    onopen = null;
    onmessage = null;
    onerror = null;
    constructor(url: string) {
      transports.push(url);
    }
    close() {}
  }
  vi.stubGlobal("EventSource", Source);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  history.replaceState(null, "", "/open?demo=refresh");
  try {
    const router = createRouter({
      routeTree: createRootRoute({ component: OpenPage }),
      history: createMemoryHistory({ initialEntries: ["/open?demo=refresh"] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(await screen.findByTestId("open-route")).toBeTruthy();
    fireEvent.click(screen.getByText("Riverside MEP.rvt"));
    expect(
      screen.getByRole("button", { name: /^Open in Revit/ }).getAttribute("aria-disabled"),
    ).toBe("true");
    await Promise.resolve();
    expect(transports).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    history.replaceState(null, "", "/");
  }
});

describe("launch plan", () => {
  test("foreign and unverified diagnostics are never default execution targets", () => {
    for (const execution of [
      {
        allowed: false,
        code: "session.no-match",
        detail: "This Revit belongs to another checkout.",
      },
      null,
    ]) {
      const session = { ...CHECKOUT_HOT, row: { ...CHECKOUT_HOT.row, execution } };
      const reading = { ...machine, revit: { ...machine.revit, sessions: [session] } };
      const plan = launchPlan(
        { ...EMPTY_DRAFT, doc: row("Riverside MEP.rvt"), year: 2025 },
        reading,
        rows,
      );
      expect(plan.live).toHaveLength(1);
      expect(plan.target).toBeNull();
      const explicit = launchPlan(
        { ...EMPTY_DRAFT, doc: row("Riverside MEP.rvt"), year: 2025, target: "pe-app-25-main" },
        reading,
        rows,
      );
      expect(explicit.refusal).toContain(execution?.detail ?? "ownership has not been verified");
      expect(explicit.launch).toBeNull();
    }
  });

  test("lifecycle refuses an ineligible diagnostic row before creating an action", async () => {
    const session = {
      ...CHECKOUT_HOT,
      row: {
        ...CHECKOUT_HOT.row,
        execution: {
          allowed: false,
          code: "session.no-match",
          detail: "This Revit belongs to another checkout.",
        },
      },
    };
    await expect(runLifecycle("stop", session, "keep")).rejects.toThrow("another checkout");
    expect(runSemanticAction).not.toHaveBeenCalled();
  });

  test("an explicit target that disappears refuses instead of starting a Revit", () => {
    const plan = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Riverside MEP.rvt"), target: "retired-session" },
      machine,
      rows,
    );
    expect(plan.refusal).toContain("no longer available");
    expect(plan.launch).toBeNull();
  });

  test("cloud identity matches region, project and model across labels", () => {
    const project = "11111111-1111-1111-1111-111111111111";
    const model = "22222222-2222-2222-2222-222222222222";
    const source = `cld://US/${project}/${model}`;
    const held = {
      ...CHECKOUT_HOT,
      documents: [{ ...CHECKOUT_HOT.documents![0]!, path: source, title: "Tower.rvt" }],
    } as MachineSession;
    const recent = {
      ...RECENTS.result.recents[0]!,
      isCloud: true,
      title: "Tower.rvt",
      region: "US",
      projectGuid: project,
      modelGuid: model,
      path: `cld://US/{${project}}OldProject/{${model}}Tower.rvt`,
    } as RecentDocument;
    expect(modelRows([held], [recent])[0]!.openIn?.session).toBe(held);
    expect(
      modelRows(
        [held],
        [recent, { ...recent, path: recent.path.replace("OldProject", "RenamedProject") }],
      ),
    ).toHaveLength(1);
    const discovered = modelRows([held], [recent]);
    expect(launchPlan({ ...EMPTY_DRAFT, doc: source }, machine, discovered).refusal).toContain(
      "already open",
    );
    for (const different of [
      { ...recent, region: "EMEA", path: recent.path.replace("US", "EMEA") },
      {
        ...recent,
        projectGuid: "33333333-3333-3333-3333-333333333333",
        path: recent.path.replaceAll(project, "33333333-3333-3333-3333-333333333333"),
      },
      {
        ...recent,
        modelGuid: "44444444-4444-4444-4444-444444444444",
        path: recent.path.replaceAll(model, "44444444-4444-4444-4444-444444444444"),
      },
    ])
      expect(modelRows([held], [different])[0]!.openIn).toBeNull();
  });
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
      'pe-revit doc open "C:\\Models\\Riverside MEP.rvt" --id <minted> --unsynced keep --links refuse',
    ]);
    expect(plan.note).toContain("two commands");
    expect(plan.launch).toEqual({
      key: "instances.open",
      input: {
        source: "C:\\Models\\Riverside MEP.rvt",
        into: { start: { year: "2024", owner: "pea", addins: "off" } },
        upgrade: false,
        links: "refuse",
      },
    });
  });
});

function handleWith() {
  return { note: vi.fn() } as unknown as OpenHandle;
}

function Harness({
  handle,
  initial,
  world = machine,
  docs = rows,
}: {
  handle: OpenHandle;
  initial: LaunchDraft;
  world?: Machine | null;
  docs?: DocRow[];
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <>
      <Launcher
        handle={handle}
        machine={world}
        rows={docs}
        draft={draft}
        setDraft={setDraft}
        fixture={false}
      />
      <RunningList
        sessions={world?.revit.sessions ?? null}
        loading={false}
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

test("a document outside the recents survives the launch press and opens in a new Revit", async () => {
  const document = "C:\\Models\\NotInRecents.rvt";
  const handle = handleWith();
  render(<Harness handle={handle} initial={{ ...EMPTY_DRAFT, doc: document }} docs={[]} />);
  await screen.findByText(document);
  fireEvent.click(screen.getByRole("button", { name: "Start Revit 2026 and open" }));
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  const [action, input, , bases] = vi.mocked(runSemanticAction).mock.calls[0]!;
  expect(action).toBe("instances.open");
  expect(input).toMatchObject({
    source: document,
    into: { start: { year: "2026", owner: "you", addins: "on" } },
  });
  expect(bases).toEqual({});
});

test("an older file names its upgrade in the verb and sends the consent", async () => {
  const handle = handleWith();
  render(
    <Harness
      handle={handle}
      initial={{ ...EMPTY_DRAFT, doc: row("Riverside MEP.rvt"), year: 2026, target: "new" }}
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: /^Start Revit 2026, upgrade and open/ }),
  );
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  expect(vi.mocked(runSemanticAction).mock.calls[0]![1]).toMatchObject({
    into: { start: { year: "2026" } },
    upgrade: true,
  });
});

test("Open here on an icon-started Revit dispatches the open by pid with no staging", async () => {
  const handle = handleWith();
  render(<Harness handle={handle} initial={{ ...EMPTY_DRAFT, doc: row("Riverside MEP.rvt") }} />);
  const observed = screen.getByRole("group", { name: "Revit 2024 started from the Revit icon" });
  fireEvent.click(within(observed).getByRole("button", { name: "open here" }));
  const launch = await screen.findByRole("button", { name: "Open in Revit 2024" });
  expect(document.querySelector("[data-argv]")!.textContent).toContain("--pid 2402");
  fireEvent.click(launch);
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  expect(vi.mocked(runSemanticAction).mock.calls[0]!.slice(0, 4)).toEqual([
    "instances.open",
    {
      source: "C:\\Models\\Riverside MEP.rvt",
      into: { session: { pid: 2402 } },
      upgrade: false,
      links: "refuse",
    },
    undefined,
    {},
  ]);
});

test("hr is drawn only for a hot-reload shape", () => {
  render(<RunningSession session={CHECKOUT_HOT} refusal={null} onHere={() => {}} />);
  expect(screen.queryByRole("button", { name: "hr" })).not.toBeNull();
  cleanup();
  for (const session of [OBSERVED_ICON, BACKGROUND_BOOTING]) {
    render(<RunningSession session={session} refusal={null} onHere={() => {}} />);
    expect(screen.queryByRole("button", { name: "hr" })).toBeNull();
    cleanup();
  }
});

test("Stop keeps work by default; discard is offered only for a checkout session", async () => {
  render(<RunningSession session={OBSERVED_ICON} refusal={null} onHere={() => {}} />);
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
  render(<RunningSession session={CHECKOUT_HOT} refusal={null} onHere={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  expect(screen.queryByRole("button", { name: "stop, discard edits" })).not.toBeNull();
});
