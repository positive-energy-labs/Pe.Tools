/**
 * Instances seed data — plain values, no component, no behaviour. `?demo=<action>` mounts one of
 * these through `useRoute`'s demo owner. Every value here is shaped as the WIRE observation its
 * Reading carries, so a seed is a recorded moment of the SDK census rather than a second model.
 * Promoted from the deleted `instances/fixture.tsx` lane (route-primitive fold 5).
 */
import type { Seed } from "@pe/agent-contracts";
import type { InstancesDocument } from "@pe/agent-contracts";

import type { InstancesReading } from "#/instances/manifest";

const observedAt = "2026-08-30T18:30:00Z";
const observedAtMs = Date.parse(observedAt);

const process = (pid: number, year: number) => ({
  pid,
  processStartUtc: observedAt,
  executable: `C:\\Program Files\\Autodesk\\Revit ${year}\\Revit.exe`,
});

const receipt = (id: string) => ({
  payload: "checkout" as const,
  buildStamp: "demo",
  generationId: "demo-generation",
  generationRoot: "C:\\Demo\\generation",
  overridePath: null,
  receiptPath: `C:\\Demo\\${id}.json`,
});

const controlledRow = (
  id: string,
  year: number,
  pid: number,
  bridge: "ready" | "unresponsive-endpoint",
) => ({
  case: "controlled-active",
  id,
  year,
  process: process(pid, year),
  bridge:
    bridge === "ready"
      ? { bridge, sessionDescriptor: `C:\\Demo\\${id}.session.json` }
      : { bridge },
  detail: "demo review fact",
  observedAtUtc: observedAt,
  origin: "demo",
  project: "Pe.App",
  receipt: receipt(id),
  worktree: "C:\\Demo\\Pe.Tools",
});

/** `session list --all` rows: the SDK census exactly as the `sessions` Reading delivers it. */
const censusRows = [
  controlledRow("demo-dev-25", 2025, 2501, "ready"),
  {
    case: "observed-active",
    bridge: { bridge: "answering", sessionDescriptor: null },
    observedAtUtc: observedAt,
    process: process(2402, 2024),
    year: 2024,
  },
  {
    case: "controlled-pending",
    attempt: {
      attempt: "launched",
      bridge: { bridge: "missing-endpoint" },
      process: process(2603, 2026),
    },
    detail: "Revit is inside its startup window.",
    id: "demo-installed-26",
    observedAtUtc: observedAt,
    origin: "demo",
    project: "Pe.App",
    receipt: receipt("demo-installed-26"),
    worktree: "C:\\Demo\\Pe.Tools",
    year: 2026,
  },
  controlledRow("demo-dev-24-stalled", 2024, 2404, "unresponsive-endpoint"),
];

/** `bridge.sessions.list` entries: what the `inventory` Reading delivers. */
const bridgeEntries = [
  {
    sessionId: "bridge-demo-dev-25",
    sdkSessionId: "demo-dev-25",
    processId: 2501,
    processStartUtcUnixMs: observedAtMs,
    connected: true,
    lane: "dev",
    custody: "controlled",
    revitVersion: "2025",
    activeDocumentPath: "C:\\Models\\project-a Tower.rvt",
    activeDocumentTitle: "project-a Tower.rvt",
    activeDocumentObservedAtUnixMs: observedAtMs,
    openDocumentCount: 2,
    openDocuments: [
      {
        openId: "project-a-open",
        address: "C:\\Models\\project-a Tower.rvt",
        title: "project-a Tower.rvt",
        isActive: true,
        isFamilyDocument: false,
      },
      {
        openId: "shell-open",
        address: "C:\\Models\\project-a Shell.rvt",
        title: "project-a Shell.rvt",
        isActive: false,
        isFamilyDocument: false,
      },
    ],
  },
  {
    sessionId: "bridge-observed-desktop",
    processId: 2402,
    processStartUtcUnixMs: observedAtMs,
    connected: true,
    lane: "installed",
    custody: "observed",
    revitVersion: "2024",
    activeDocumentPath: "C:\\Models\\Clinic Renovation.rvt",
    activeDocumentTitle: "Clinic Renovation.rvt",
    activeDocumentObservedAtUnixMs: observedAtMs,
    openDocumentCount: 1,
    openDocuments: [],
  },
];

const recentRows = [
  {
    title: "project-a Tower.rvt",
    path: "C:\\Models\\project-a Tower.rvt",
    isCloud: false,
  },
  {
    title: "Clinic Renovation.rvt",
    path: "C:\\Models\\Clinic Renovation.rvt",
    isCloud: false,
  },
];

const emptyWork: InstancesDocument = { staged: null };

/**
 * One seed per action key, total over them: `refresh` is the only route-level action, so the
 * whole demo lane is the moment just before the census is reacquired.
 */
export const INSTANCES_SEEDS: Record<"refresh", Seed<InstancesDocument, InstancesReading, object>> =
  {
    refresh: {
      title: "four Revits, two connected, nothing staged",
      work: emptyWork,
      readings: {
        sessions: {
          result: {
            sessions: censusRows,
            unreadableReceipts: [],
            processReadErrors: [],
            registryRoot: "C:\\Demo\\sessions",
          },
        },
        inventory: { sessions: bridgeEntries },
        doctor: { result: { revitYears: ["2024", "2025", "2026"] } },
        recents: { result: { recents: recentRows } },
      },
      page: {},
    },
  };
