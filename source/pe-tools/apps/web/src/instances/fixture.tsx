import type { SessionObservation } from "@pe/host-contracts/pe-revit-contract";

import type { SessionFacts } from "#/host/target";
import { InstancesWorkspace, type InstancesFleet } from "#/instances/workspace";

const observedAt = "2026-08-30T18:30:00Z";

const process = (pid: number, year: number) => ({
  pid,
  processStartUtc: observedAt,
  executable: `C:\\Program Files\\Autodesk\\Revit ${year}\\Revit.exe`,
});

const receipt = (id: string) => ({
  payload: "checkout" as const,
  buildStamp: "fixture",
  generationId: "fixture-generation",
  generationRoot: "C:\\Fixtures\\generation",
  overridePath: null,
  receiptPath: `C:\\Fixtures\\${id}.json`,
});

const controlledRow = (
  id: string,
  year: number,
  pid: number,
  bridge: "ready" | "unresponsive-endpoint",
): SessionObservation => ({
  case: "controlled-active",
  id,
  year,
  process: process(pid, year),
  bridge:
    bridge === "ready"
      ? { bridge, sessionDescriptor: `C:\\Fixtures\\${id}.session.json` }
      : { bridge },
  detail: "fixture review fact",
  observedAtUtc: observedAt,
  origin: "fixture",
  project: "Pe.App",
  receipt: receipt(id),
  worktree: "C:\\Fixtures\\Pe.Tools",
});

const observedRow: SessionObservation = {
  case: "observed-active",
  bridge: { bridge: "answering", sessionDescriptor: null },
  observedAtUtc: observedAt,
  process: process(2402, 2024),
  year: 2024,
};

const bootingRow: SessionObservation = {
  case: "controlled-pending",
  attempt: {
    attempt: "launched",
    bridge: { bridge: "missing-endpoint" },
    process: process(2603, 2026),
  },
  detail: "Revit is inside its startup window.",
  id: "fixture-installed-26",
  observedAtUtc: observedAt,
  origin: "fixture",
  project: "Pe.App",
  receipt: receipt("fixture-installed-26"),
  worktree: "C:\\Fixtures\\Pe.Tools",
  year: 2026,
};

const controlled: SessionFacts = {
  sessionId: "bridge-fixture-dev-25",
  sdkSessionId: "fixture-dev-25",
  processId: 2501,
  year: "2025",
  lane: "dev",
  custody: "controlled",
  activeDocumentId: "C:\\Models\\project-a Tower.rvt",
  activeDocumentTitle: "project-a Tower.rvt",
  openDocumentCount: 2,
  observedAtUnixMs: Date.parse(observedAt),
};

const observed: SessionFacts = {
  sessionId: "bridge-observed-desktop",
  processId: 2402,
  year: "2024",
  lane: "installed",
  custody: "observed",
  activeDocumentId: "C:\\Models\\Clinic Renovation.rvt",
  activeDocumentTitle: "Clinic Renovation.rvt",
  openDocumentCount: 1,
  observedAtUnixMs: Date.parse(observedAt),
};

const fixtureFleet: InstancesFleet = {
  sessions: [controlled, observed],
  worlds: [
    {
      id: "fixture-dev-25",
      custody: "controlled",
      phase: "ready",
      detail: "fixture review fact",
      lane: "dev",
      pid: 2501,
      session: controlled,
      row: controlledRow("fixture-dev-25", 2025, 2501, "ready"),
    },
    {
      id: "observed-desktop",
      custody: "observed",
      phase: "ready",
      detail: "fixture review fact",
      lane: "installed",
      pid: 2402,
      session: observed,
      row: observedRow,
    },
    {
      id: "fixture-installed-26",
      custody: "controlled",
      phase: "booting",
      detail: "Revit is inside its startup window.",
      lane: "installed",
      pid: 2603,
      row: bootingRow,
    },
    {
      id: "fixture-dev-24-stalled",
      custody: "controlled",
      phase: "unresponsive",
      detail: "The process exists but the SDK bridge stopped answering.",
      lane: "dev",
      pid: 2404,
      row: controlledRow("fixture-dev-24-stalled", 2024, 2404, "unresponsive-endpoint"),
    },
  ],
  unreadableReceipts: [],
  processReadErrors: [],
  registryRoot: "C:\\Fixtures\\sessions",
  isLoading: false,
  stale: false,
  error: null,
  at: Date.parse(observedAt),
  basis: ["fixture:instances"],
};

export function FixtureInstancesPage({
  target,
  setTarget,
}: {
  target: string;
  setTarget: (target: string) => void;
}) {
  return (
    <InstancesWorkspace
      target={target}
      setTarget={setTarget}
      fleet={fixtureFleet}
      source="fixture"
    />
  );
}
