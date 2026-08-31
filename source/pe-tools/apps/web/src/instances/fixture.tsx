import { useState } from "react";
// TODO(sdk-beta132): `Leg` and `SessionRow` stopped being exported by the generated
// pe-revit-contract at the beta.132 cutover; this file has 6 type errors that only per-file
// `vp check` sees (the test path never type-checks it). Re-derive these fixture types from the
// contract's current exports. Found 2026-08-31 by the route-shell spike.
import type { Leg, SessionRow } from "@pe/host-contracts/pe-revit-contract";

import type { SessionFacts } from "#/host/target";
import { InstancesWorkspace, type InstancesFleet } from "#/instances/workspace";

const observedAt = "2026-08-30T18:30:00Z";

const leg = (name: string, state: string, pid: number): Leg => ({
  name,
  state,
  pid,
  how: state === "up" ? "health" : "pid",
  kind: name,
  legBecause: "fixture review fact",
  observedAtUtc: observedAt,
  url: name === "host" ? `http://127.0.0.1:${5000 + (pid % 1000)}` : null,
});

const row = (
  value: Pick<SessionRow, "id" | "custody" | "lane" | "phase" | "pid" | "state" | "year"> &
    Partial<SessionRow>,
): SessionRow => ({
  activeDocument: null,
  buildStamp: "fixture",
  detail: "fixture review fact",
  documents: [],
  ephemeral: false,
  failedAtUtc: null,
  failureCode: null,
  failureDetail: null,
  firstFailureEvent: null,
  generationId: "fixture-generation",
  generationRoot: "C:\\Fixtures\\generation",
  journal: null,
  legs: [],
  observedAtUtc: observedAt,
  origin: "fixture",
  overriddenAssembly: null,
  override: null,
  payload: "Pe.App.dll",
  port: null,
  project: "Pe.App",
  receipt: "C:\\Fixtures\\session.json",
  startedAtUtc: observedAt,
  stoppedAtUtc: null,
  testProject: null,
  worktree: "C:\\Fixtures\\Pe.Tools",
  ...value,
});

const controlled: SessionFacts = {
  sessionId: "bridge-fixture-dev-25",
  sdkSessionId: "fixture-dev-25",
  processId: 2501,
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
      lane: "dev",
      year: "25",
      pid: 2501,
      activeDocumentTitle: "project-a Tower.rvt",
      openDocumentCount: 2,
      session: controlled,
      row: row({
        id: "fixture-dev-25",
        custody: "controlled",
        lane: "dev",
        phase: "ready",
        pid: 2501,
        state: "RUNNING",
        year: "25",
        legs: [leg("revit", "up", 2501), leg("host", "up", 2511)],
      }),
    },
    {
      id: "observed-desktop",
      custody: "observed",
      phase: "ready",
      lane: "installed",
      year: "24",
      pid: 2402,
      activeDocumentTitle: "Clinic Renovation.rvt",
      openDocumentCount: 1,
      session: observed,
      row: row({
        id: "observed-desktop",
        custody: "observed",
        lane: "installed",
        phase: "ready",
        pid: 2402,
        state: "OBSERVED",
        year: "24",
        receipt: null,
        legs: [leg("revit", "up", 2402), leg("host", "up", 2412)],
      }),
    },
    {
      id: "fixture-installed-26",
      custody: "controlled",
      phase: "booting",
      lane: "installed",
      year: "26",
      pid: 2603,
      openDocumentCount: 0,
      row: row({
        id: "fixture-installed-26",
        custody: "controlled",
        lane: "installed",
        phase: "booting",
        pid: 2603,
        state: "STARTING",
        year: "26",
        detail: "Revit is inside its startup window.",
        legs: [leg("revit", "up", 2603), leg("host", "down", 2613)],
      }),
    },
    {
      id: "fixture-dev-24-stalled",
      custody: "controlled",
      phase: "unresponsive",
      lane: "dev",
      year: "24",
      pid: 2404,
      activeDocumentTitle: "Tower Core.rvt",
      openDocumentCount: 1,
      row: row({
        id: "fixture-dev-24-stalled",
        custody: "controlled",
        lane: "dev",
        phase: "unresponsive",
        pid: 2404,
        state: "UNRESPONSIVE",
        year: "24",
        detail: "The process exists but the SDK bridge stopped answering.",
        legs: [leg("revit", "up", 2404), leg("host", "down", 2414)],
      }),
    },
  ],
  isLoading: false,
  stale: false,
  error: null,
  at: Date.parse(observedAt),
  basis: ["fixture:instances"],
};

export function FixtureInstancesPage() {
  const [target, setTarget] = useState("");
  return (
    <InstancesWorkspace
      target={target}
      setTarget={setTarget}
      fleet={fixtureFleet}
      source="fixture"
    />
  );
}
