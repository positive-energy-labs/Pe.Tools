// @vitest-environment jsdom
/**
 * The patch bay over the recorded world: the plan refuses before the press, the verb names every
 * consequence, a jack patched by click and by the command line builds the same launch, an
 * icon-started Revit is reached by pid, hr shows only for a hot-reload shape, and Stop keeps
 * work unless the Revit is a checkout session.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { MachineAccess, Machine, MachineSession } from "@pe/agent-contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { RecentDocument } from "@pe/host-contracts/pe-revit-contract";

import { runSemanticAction } from "../../../../packages/mcps/src/shared/takeoff-action-client";
import { PatchBay } from "./bay";
import { jobsOf } from "./model";
import { runLifecycle } from "./lifecycle";
import { EMPTY_DRAFT, defaultYear, launchPlan, modelRows, type DocRow } from "./model";
import { OpenPage } from "./route";
import {
  BACKGROUND_BOOTING,
  BAY_PEA_25,
  BAY_RECENTS,
  BAY_THREADS,
  CHECKOUT_HOT,
  MACHINE_SEEDS,
  OBSERVED_ICON,
  RECENTS,
} from "./seeds";

test("a known file year defaults only to that installed year; upgrade requires a choice", () => {
  const doc = { savedYear: 2024, lastYear: 2026 } as DocRow;
  expect(defaultYear(doc, [2025, 2026])).toBeNull();
  expect(defaultYear(doc, [2026, 2024, 2025])).toBe(2024);
  expect(defaultYear(doc, [2023])).toBeNull();
});

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

const world = (MACHINE_SEEDS["patch-bay"] as { observation: Machine }).observation;
const rows = modelRows(world.revit.sessions!, BAY_RECENTS.result.recents);
const row = (title: string) => rows.find((candidate) => candidate.title === title)!.key;
const YOURS = "pid:18244";
const PEA_25 = "pea-25-schedules";

const withSessions = (sessions: MachineSession[]): Machine => ({
  ...world,
  revit: { ...world.revit, sessions },
});

test("the frozen Open route renders the bay and patches without opening a host transport", async () => {
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
    expect(await screen.findByTestId("patch-bay")).toBeTruthy();
    fireEvent.click(screen.getByText("Clinic-Fitout.rvt"));
    fireEvent.click(
      screen.getByText("patch Clinic-Fitout.rvt here", {
        selector: "[data-key='free:pid:18244'] *",
      }),
    );
    const verb = screen.getByRole("button", {
      name: "Open in your Revit 2025 and upgrade from 2023",
    });
    expect(verb.getAttribute("aria-disabled")).toBe("true");
    await Promise.resolve();
    expect(transports).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    history.replaceState(null, "", "/");
  }
});

describe("launch plan", () => {
  test("an absent saved year requires an explicit upgrade choice", () => {
    const plan = launchPlan({ ...EMPTY_DRAFT, doc: row("Clinic-Fitout.rvt") }, world, rows);
    expect(plan.refusal).toContain("Revit 2023 is not installed");
    expect(plan.waiting).toBeNull();
    expect(plan.launch).toBeNull();
    expect(plan.year).toBeNull();
  });

  test("an older file patched into your running Revit names the upgrade", () => {
    const plan = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Clinic-Fitout.rvt"), target: YOURS },
      world,
      rows,
    );
    expect(plan.verb).toBe("Open in your Revit 2025 and upgrade from 2023");
    expect(plan.refusal).toBeNull();
    expect(plan.launch).toEqual({
      key: "instances.open",
      input: {
        source: "C:\\Projects\\Clinic\\Clinic-Fitout.rvt",
        into: { session: { pid: 18244 } },
        detach: false,
        upgrade: true,
        links: "refuse",
      },
    });
    expect(plan.argv[0]).toContain("--pid 18244");
    expect(plan.cautions.map((caution) => caution.text).join(" ")).toContain("adopts it by pid");
  });

  test("a Revit older than the file refuses it, in every socket and the free one", () => {
    const yours = launchPlan(
      { ...EMPTY_DRAFT, doc: row("HCB-48.rfa"), target: YOURS },
      world,
      rows,
    );
    expect(yours.refusal).toBe(
      "HCB-48.rfa was saved in Revit 2026; Revit 2025 cannot open a newer file.",
    );
    expect(yours.launch).toBeNull();
    const free = launchPlan(
      { ...EMPTY_DRAFT, doc: row("HCB-48.rfa"), target: "new", year: 2024 },
      world,
      rows,
    );
    expect(free.refusal).toContain("Revit 2024 cannot open a newer file");
    const nowhere = launchPlan({ ...EMPTY_DRAFT, doc: row("Stadium-Concourse.rvt") }, world, rows);
    expect(nowhere.refusal).toBe(
      "Stadium-Concourse.rvt was saved in Revit 2027; the newest Revit here is 2026.",
    );
  });

  test("the free socket names the new Revit, whose it is, and every consequence", () => {
    const yours = launchPlan(
      {
        ...EMPTY_DRAFT,
        doc: row("Clinic-Fitout.rvt"),
        target: "new",
        year: 2024,
        addins: "off",
        links: "allow",
      },
      world,
      rows,
    );
    expect(yours.verb).toBe(
      "Open in a new Revit 2024 and upgrade from 2023, allowing missing links, with add-ins off",
    );
    expect(yours.launch).toEqual({
      key: "instances.open",
      input: {
        source: "C:\\Projects\\Clinic\\Clinic-Fitout.rvt",
        into: { start: { year: "2024", owner: "you", addins: "off" } },
        detach: false,
        upgrade: true,
        links: "allow",
      },
    });
    expect(yours.argv).toEqual([
      "pe-revit session start --year 2024 --quarantine",
      "pe-revit doc open C:\\Projects\\Clinic\\Clinic-Fitout.rvt --id <minted> --upgrade --links allow",
    ]);
    const pea = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Chadds-Ford-Coord.rvt"), target: "new", owner: "pea" },
      world,
      rows,
    );
    expect(pea.verb).toBe("Give Pea a copy in a new background Revit 2025");
    expect(pea.launch).toBeNull();
    expect(pea.refusal).toContain("immutable APS version");
    expect(pea.cautions.map((caution) => caution.text)).toContain(
      "An immutable APS version is required before Pea can acquire a cloud copy.",
    );
  });

  test("a document open in your Revit refuses a second open there, and goes to Pea as a copy", () => {
    const held = launchPlan({ ...EMPTY_DRAFT, doc: row("Hospital-MEP_kaitp.rvt") }, world, rows);
    expect(held.refusal).toBe("Hospital-MEP_kaitp.rvt is already open in Revit 2025 (pid 18244).");
    const pea = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Hospital-MEP_kaitp.rvt"), target: PEA_25 },
      world,
      rows,
    );
    expect(pea.refusal).toBeNull();
    expect(pea.verb).toBe("Give Pea a copy in Pea's Revit 2025");
    expect(pea.launch).toMatchObject({ input: { into: { session: { id: PEA_25 } } } });
  });

  test("a socket that vanished, boots, or belongs elsewhere refuses before anything dispatches", () => {
    const gone = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Clinic-Fitout.rvt"), target: "retired-session" },
      world,
      rows,
    );
    expect(gone.refusal).toContain("no longer running");
    const booting = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Clinic-Fitout.rvt"), target: "pe-app-26-installed" },
      withSessions([BACKGROUND_BOOTING]),
      rows,
    );
    expect(booting.refusal).toContain("is booting; it opens nothing until it answers");
    const foreign = {
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
    const refused = launchPlan(
      { ...EMPTY_DRAFT, doc: row("Clinic-Fitout.rvt"), target: "pe-app-25-main" },
      withSessions([foreign]),
      rows,
    );
    expect(refused.refusal).toContain("another checkout");
    expect(refused.launch).toBeNull();
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

  test("a cloud copy refuses in Open until an immutable version can be selected", () => {
    const cloud: DocRow = {
      ...rows[0]!,
      key: "cloud-version",
      selector: "cld://US/{p}/{m}Tower.rvt",
      title: "Tower",
      cloud: true,
      savedYear: 2025,
      openIn: null,
    };
    const plan = launchPlan({ ...EMPTY_DRAFT, doc: cloud.key, target: PEA_25 }, world, [cloud]);
    expect(plan.refusal).toContain("immutable APS version");
    expect(plan.launch).toBeNull();
  });
});

describe("jobs from the thread list", () => {
  test("heads in Pea's Revits are her jobs", () => {
    const jobs = jobsOf(BAY_THREADS, world.revit.sessions!);
    expect(jobs.map((job) => [job.thread.title, job.session.row.year])).toEqual([
      ["Schedule cleanup L1-L4", 2025],
      ["Build HCB family", 2026],
    ]);
    expect(jobs[0]!.session).toBe(BAY_PEA_25);
  });
});

function Bay({
  machine = world,
  docs = rows,
  layout = "row",
}: {
  machine?: Machine;
  docs?: DocRow[];
  layout?: "row" | "stack";
}) {
  return (
    <PatchBay
      machine={machine}
      loading={false}
      rows={docs}
      threads={BAY_THREADS}
      fixture={false}
      layout={layout}
    />
  );
}

/** The bay over a machine, with the table rebuilt from that machine's own sessions. */
const BayOf = ({ machine }: { machine: Machine }) => (
  <Bay machine={machine} docs={modelRows(machine.revit.sessions!, BAY_RECENTS.result.recents)} />
);

const yoursCard = () =>
  screen.getByRole("group", { name: "Revit 2025 started from the Revit icon" });
const box = () => screen.getByRole("combobox", { name: "table query" }) as HTMLInputElement;
const typeInto = (text: string) => {
  for (let i = 1; i <= text.length; i++)
    fireEvent.change(box(), { target: { value: box().value + text[i - 1] } });
};
const chip = (label: string) => screen.getByText(label, { selector: "[data-slot='query-box'] *" });
const jack = (title: string) =>
  within(screen.getByRole("grid", { name: "documents" })).getByText(title);
const newYear = (year: string, pressed: boolean) =>
  within(screen.getByRole("group", { name: "new Revit year" })).getByRole("button", {
    name: year,
    pressed,
  });

test("patching Clinic into your Revit 2025 by click names the upgrade and sends the consent", async () => {
  render(<Bay />);
  fireEvent.click(screen.getByText("Clinic-Fitout.rvt"));
  fireEvent.click(within(yoursCard()).getByText("patch Clinic-Fitout.rvt here"));
  const verb = within(yoursCard()).getByRole("button", {
    name: "Open in your Revit 2025 and upgrade from 2023",
  });
  expect(verb.getAttribute("aria-disabled")).toBeNull();
  expect(document.querySelector("[data-argv]")!.textContent).toContain("--pid 18244");
  fireEvent.click(verb);
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  expect(vi.mocked(runSemanticAction).mock.calls[0]!.slice(0, 4)).toEqual([
    "instances.open",
    {
      source: "C:\\Projects\\Clinic\\Clinic-Fitout.rvt",
      into: { session: { pid: 18244 } },
      detach: false,
      upgrade: true,
      links: "refuse",
    },
    undefined,
    {},
  ]);
});

test("HCB-48 (2026) is refused by every 2025 socket before any press", () => {
  render(<Bay />);
  fireEvent.click(jack("HCB-48.rfa"));
  const hole = within(yoursCard()).getByText("refuses HCB-48.rfa").closest(".dl-row")!;
  expect(hole.getAttribute("aria-disabled")).toBe("true");
  expect(hole.getAttribute("title")).toBe("Revit 2025 cannot open a 2026 file");
  fireEvent.click(hole);
  expect(screen.queryByRole("button", { name: /^Open in your Revit 2025/ })).toBeNull();
});

test("the command line typed one character at a time equals the click path", async () => {
  render(<Bay />);
  box().focus();
  typeInto("clinic → new 2024 ");
  const verb = screen.getByRole("button", {
    name: "Open in a new Revit 2024 and upgrade from 2023",
  });
  expect(verb.getAttribute("aria-disabled")).toBeNull();
  // The chips are the draft: the socket the jack in hand was patched into.
  expect(chip("new 2024")).toBeTruthy();
  fireEvent.keyDown(box(), { key: "Enter" });
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  expect(vi.mocked(runSemanticAction).mock.calls[0]![1]).toEqual({
    source: "C:\\Projects\\Clinic\\Clinic-Fitout.rvt",
    into: { start: { year: "2024", owner: "you", addins: "on" } },
    detach: false,
    upgrade: true,
    links: "refuse",
  });
});

test("the command line pasted whole equals the click path, and a click reads back as chips", () => {
  render(<Bay />);
  box().focus();
  // The query and the arrow land in one event: the jack in hand is the row the pasted query keeps.
  fireEvent.change(box(), { target: { value: "clinic -> new 2024 " } });
  expect(
    screen.getByRole("button", { name: "Open in a new Revit 2024 and upgrade from 2023" }),
  ).toBeTruthy();
  fireEvent.change(box(), { target: { value: "pea" } });
  fireEvent.keyDown(box(), { key: "Tab" });
  expect(
    screen.getByRole("button", { name: "Give Pea a copy in a new background Revit 2024" }),
  ).toBeTruthy();
  expect(chip("pea")).toBeTruthy();
  // A click on the free card's year changes the same draft the chips show.
  fireEvent.click(newYear("2026", false));
  expect(chip("new 2026")).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Give Pea a copy in a new background Revit 2026" }),
  ).toBeTruthy();
});

test("the click path alone: a jack, then the free card's year, is the same plan", () => {
  render(<Bay />);
  fireEvent.click(jack("Clinic-Fitout.rvt"));
  fireEvent.click(newYear("2024", false));
  expect(
    screen.getByRole("button", { name: "Open in a new Revit 2024 and upgrade from 2023" }),
  ).toBeTruthy();
  expect(chip("new 2024")).toBeTruthy();
});

test("a pasted path becomes a jack and opens in a new Revit", async () => {
  const path = "C:\\Models\\NotInRecents.rvt";
  render(<Bay docs={[]} />);
  box().focus();
  fireEvent.change(box(), { target: { value: `${path} ` } });
  fireEvent.click(await screen.findByText("NotInRecents.rvt"));
  fireEvent.click(
    screen.getByText("patch NotInRecents.rvt here", { selector: "[data-key='free:new'] *" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Open in a new Revit 2026" }));
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  expect(vi.mocked(runSemanticAction).mock.calls[0]![1]).toMatchObject({
    source: path,
    into: { start: { year: "2026", owner: "you", addins: "on" } },
  });
});

test("hr is drawn only for a hot-reload shape, and only in the wide bay", () => {
  render(<Bay machine={withSessions([CHECKOUT_HOT])} />);
  expect(screen.queryByRole("button", { name: "hr" })).not.toBeNull();
  cleanup();
  render(<Bay machine={withSessions([CHECKOUT_HOT])} layout="stack" />);
  expect(screen.queryByRole("button", { name: "hr" })).toBeNull();
  cleanup();
  for (const session of [OBSERVED_ICON, BACKGROUND_BOOTING]) {
    render(<BayOf machine={withSessions([session])} />);
    expect(screen.queryByRole("button", { name: "hr" })).toBeNull();
    cleanup();
  }
});

test("Stop keeps work by default; discard is offered only for a checkout session", async () => {
  render(<Bay machine={withSessions([OBSERVED_ICON])} />);
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
  render(<Bay machine={withSessions([CHECKOUT_HOT])} />);
  fireEvent.click(screen.getByRole("button", { name: "stop" }));
  expect(screen.queryByRole("button", { name: "stop, discard edits" })).not.toBeNull();
});

test("a held document offers close with work kept, and discard beside it", async () => {
  render(<Bay />);
  fireEvent.click(within(yoursCard()).getAllByRole("button", { name: "close" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "close, keep work" }));
  await waitFor(() => expect(runSemanticAction).toHaveBeenCalled());
  const [action, input] = vi.mocked(runSemanticAction).mock.calls[0]!;
  expect(action).toBe("instances.close");
  expect(input).toMatchObject({
    session: { selection: { pid: 18244 } },
    document: { source: "sdk", session: { pid: 18244 }, openId: "18244-hospital" },
    unsaved: "keep",
  });
});

const accessed = (access: MachineAccess) =>
  withSessions(
    world.revit.sessions!.map((session) =>
      session.row.case === "observed-active" && session.row.process.pid === 18244
        ? {
            ...session,
            attachment: {
              ...session.attachment!,
              documents: [
                {
                  session: "bridge-18244",
                  openId: "18244-hospital",
                  title: "Hospital-MEP_kaitp.rvt",
                  address: null,
                  isFamilyDocument: false,
                  isActive: true,
                  access,
                },
              ],
            },
          }
        : session,
    ),
  );

test("thread heads alone draw no rw: the bay is not told by the heads it lists", () => {
  // BAY_THREADS point their heads at the person's Hospital-MEP, and no access says it may write.
  render(<Bay />);
  expect(BAY_THREADS.some((thread) => thread.head.defaultTarget?.kind === "open")).toBe(true);
  expect(screen.queryByText(/^rw(?: |$)/)).toBeNull();
  expect(screen.queryByRole("button", { name: "take back rw" })).toBeNull();
  expect(document.querySelector('[title^="Pea holds rw"]')).toBeNull();
  // A host reading that says read draws nothing either.
  cleanup();
  render(<BayOf machine={accessed({ kind: "read" })} />);
  expect(screen.queryByText(/^rw(?: |$)/)).toBeNull();
});

test("a grant in the host's access draws rw on the document, its thread and its expiry", () => {
  render(
    <BayOf
      machine={accessed({
        kind: "rw",
        context: "t-retag",
        label: "Retag level 2 diffusers",
        until: "2026-10-12T13:00:00.000Z",
      })}
    />,
  );
  const card = within(yoursCard());
  // The session card names the granted document by its socket title, and whose grant it is.
  expect(card.getByText("rw · Hospital-MEP_kaitp.rvt")).toBeTruthy();
  expect(card.getByText("Retag level 2 diffusers")).toBeTruthy();
  // The document's own row and the table both carry the word, because the ids coincide here.
  expect(card.getAllByText("rw").length).toBeGreaterThan(0);
  expect(screen.getAllByText("rw").length).toBeGreaterThan(card.getAllByText("rw").length);
  expect(card.queryByRole("button", { name: /take back|revoke/i })).toBeNull();
});

test("Pea's own session is rw by its access, with no thread or expiry", () => {
  const pea = world.revit.sessions!.find((session) => session.whose === "pea")!;
  const session = {
    ...pea,
    attachment: {
      ...pea.attachment!,
      documents: pea.documents!.map((document) => ({
        session: pea.attachment!.session,
        openId: document.openId!,
        title: document.title ?? "",
        address: null,
        isFamilyDocument: false,
        isActive: true,
        access: { kind: "pea", acquisition: "acq-1" } as const,
      })),
    },
  };
  render(<Bay machine={withSessions([session])} />);
  expect(screen.getAllByText("rw").length).toBeGreaterThanOrEqual(pea.documents!.length);
  expect(screen.queryByText(/^rw ·/)).toBeNull();
});
