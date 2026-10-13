/// <reference lib="es2023.array" />
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { machineInventory, type Machine } from "@pe/agent-contracts";
import { SessionCard, SessionRow } from "#/components/lang/session";
import { custodyOf, phaseOf, PHASE_TONE, executionRefusal, pidOf } from "#/machine/session";
import { BAY_YOURS_25, CHECKOUT_HOT, MACHINE_SEEDS } from "./seeds";
import { createMachine, type MachineSources } from "../../../host/src/machine.ts";
import { peFind } from "../../../../packages/mcps/src/pea/capability-tools.ts";
import { fakeRuntimeHost } from "../../../../packages/mcps/tests/runtime-host-fixture.ts";
import pageSource from "../../../host/src/pages/pe.js?raw";
import { runInNewContext } from "node:vm";

afterEach(() => {
  cleanup();
  document.querySelector("pe-bind")?.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("F8: web rows and pe_find preserve the same Machine identities, access and unknown evidence", async () => {
  fakeRuntimeHost("http://127.0.0.1:9");
  const seed = Object.values(MACHINE_SEEDS).find((r) => r.state === "ready")!;
  if (seed.state !== "ready") throw Error("fixture missing");
  if (BAY_YOURS_25.row.case !== "observed-active") throw Error("observed fixture missing");
  const observed = BAY_YOURS_25.row;
  const foreign = {
    ...observed,
    process: { ...observed.process, pid: 43 },
    execution: { allowed: false, code: "runtime.foreign", detail: "Foreign runtime" },
    shape: { ...observed.shape, posture: "background" as const },
  };
  const disconnected = { ...observed, process: { ...observed.process, pid: 44 } };
  const controlled = {
    ...CHECKOUT_HOT.row,
    bridge: {
      ...CHECKOUT_HOT.row.bridge,
      documents: [{ ...CHECKOUT_HOT.documents![0]!, persistence: null }],
    },
  };
  const holdingsUnknown = {
    ...controlled,
    id: "holdings-unread",
    process: { ...controlled.process, pid: 46 },
    bridge: { ...controlled.bridge, documents: null },
  };
  const knownHoldings = [
    {
      openId: controlled.bridge.documents[0]!.openId!,
      title: "Model",
      holdings: {
        empty: false,
        unsaved: false,
        workshared: true,
        savedNotSynced: null,
        worksets: ["Mechanical"],
        elements: [
          {
            id: 17,
            category: "Ducts",
            name: "Supply",
            changedSinceSync: null,
            requesters: ["Alice", "Bob"],
          },
        ],
      },
    },
  ];
  const attachment = (pid: number, session: string) => ({
    session,
    pid,
    processStartUtcUnixMs: Date.parse(observed.process.processStartUtc),
    documents: [
      {
        session,
        openId: "exact-open",
        title: "Grant document",
        address: null,
        isActive: true,
        isFamilyDocument: false,
      },
    ],
  });
  const sources: MachineSources = {
    host: async () => {
      throw Error("host record unavailable");
    },
    peers: async () => [],
    sessions: async () => [observed, foreign, disconnected, controlled, holdingsUnknown],
    documents: async () => new Promise(() => {}),
    holdings: async (process) => (process.pid === controlled.process.pid ? knownHoldings : null),
    attachments: async () => [
      attachment(observed.process.pid, "exact-bridge"),
      attachment(43, "foreign-bridge"),
    ],
    actions: async () => [],
    years: async () => [2025],
    providers: async () => ({ providers: [], access: { guarded: true } }),
    share: {
      read: async () => {
        throw Error("share unavailable");
      },
    },
    update: {
      current: () => seed.observation.update,
      refresh: async () => seed.observation.update,
      automaticPending: () => false,
      apply: async () => seed.observation.update,
    },
    grants: {
      subscribe: () => () => {},
      grants: () =>
        ["exact-bridge", "foreign-bridge"].map((session) => ({
          thread: "thread-1",
          title: "Review ducts",
          grant: {
            lifetime: { session, openId: "exact-open" },
            grantedAt: "2026-10-12T00:00:00.000Z",
            grantedVia: "local",
            revoked: null,
            expiresAt: "2026-10-14T00:00:00.000Z",
          },
        })),
    },
  };
  vi.useFakeTimers({ now: Date.parse("2026-10-13T00:00:00Z") });
  const owner = createMachine(sources);
  const refresh = owner.refresh();
  await vi.advanceTimersByTimeAsync(15_001);
  const machine = await refresh;
  owner.close();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ at: machine.observedAtUtc, machine, sources: {}, capabilities: [] }),
    ),
  );
  const map = (await peFind.execute!({ limit: 8 }, {} as never)) as { machine: Machine };
  expect(map.machine).toEqual(machine);
  for (const [index, session] of map.machine.revit.sessions!.entries()) {
    const phase = phaseOf(session.row);
    const facts = {
      year: session.row.year,
      name: null,
      pid: pidOf(session.row),
      phase,
      phaseTone: PHASE_TONE[phase],
      custody: custodyOf(session.row),
      dialog: false,
    };
    render(
      <>
        <SessionCard session={session} facts={facts} anchor={`card-${index}`} />
        <SessionRow session={session} facts={facts} anchor={`row-${index}`} />
      </>,
    );
  }
  expect(screen.getByText("Review ducts")).toBeTruthy();
  expect(screen.getAllByText(/documents unread: Error: documents:.*leg exceeded/)).toHaveLength(3);
  expect(screen.queryByText("no document open")).toBeNull();
  expect(screen.getAllByText("observed")).toHaveLength(3);
  expect(map.machine.revit.sessions![1]!.whose).toBe("you");
  expect(map.machine.revit.sessions![1]!.attachment!.documents![0]!.access).toEqual({
    kind: "read",
  });
  expect(executionRefusal(map.machine.revit.sessions![1]!.row)).toBe("Foreign runtime");
  expect(machineInventory(map.machine)).toMatchObject({
    sessions: { "foreign-bridge": { kind: "failed", message: "Foreign runtime" } },
  });
  expect(screen.getAllByText("Foreign runtime")).toHaveLength(2);
  expect(map.machine.revit.sessions![2]!.attachment).toBeNull();
  expect(map.machine.revit.sessions![3]!.documents![0]!.persistence).toBeNull();
  expect(screen.getByText("persistence unknown")).toBeTruthy();
  expect(map.machine.revit.sessions![3]!.holdings).toEqual(knownHoldings);
  expect(map.machine.revit.sessions![4]!.holdings).toBeNull();
  expect(map.machine.revit.sessions![4]!.documents).toBeNull();
  expect(
    within(document.querySelector('[data-key="card-4"]')!).getByText("documents unknown"),
  ).toBeTruthy();
  expect(
    machineInventory({
      ...machine,
      revit: {
        ...machine.revit,
        unclassifiedAttachments: [{ ...attachment(45, "unknown"), documents: null }],
      },
    }),
  ).toMatchObject({ sessions: { unknown: { kind: "checking" } } });
});

test("the standalone Page chip renders the host write verdict without expiring it locally", async () => {
  vi.useFakeTimers();
  const source = pageSource.replace(
    "/*pe:runtime*/ null",
    JSON.stringify({ header: "x-pe-runtime", query: "runtime", service: "fixture" }),
  );
  let write: object = { kind: "rw", thread: "t1", expiresAt: "2000-01-01T00:00:00.000Z" };
  const fakeWindow = { addEventListener() {}, open() {}, pe: undefined as any };
  runInNewContext(source, {
    window: fakeWindow,
    document,
    location: new URL("http://127.0.0.1:9/pages/ducts/"),
    URL,
    Headers,
    Request,
    performance,
    Date,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    EventSource: class {
      addEventListener() {}
      close() {}
    },
    fetch: async (input: string) =>
      String(input).endsWith("/target")
        ? Response.json({
            binding: { kind: "thread", thread: "t1" },
            resolution: { kind: "resolved" },
            document: { title: "Ducts" },
            write,
            hostNow: "2000-01-01T00:00:00.000Z",
          })
        : new Response("page"),
  });
  await fakeWindow.pe.target();
  const chip = () =>
    document.querySelector("pe-bind")!.shadowRoot!.querySelector(".pe-bind-write")!.textContent;
  expect(chip()).toMatch(/^rw/);
  await vi.advanceTimersByTimeAsync(90_000);
  expect(chip()).toMatch(/^rw/);
  write = { kind: "read", refusal: { reason: "Host expired the grant" } };
  await fakeWindow.pe.target();
  expect(chip()).toBe("read");
});
