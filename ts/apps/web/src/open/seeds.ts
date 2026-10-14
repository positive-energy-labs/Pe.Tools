/**
 * Machine and Open fixtures: recorded moments of the host's one `Machine` reading and the SDK's
 * recents, in the generated wire shapes, never a second model. The tests, the `/open?demo=` seed
 * and the design-system specimen all draw these. A fixture is a `Reading<Machine>` because the
 * honest gap (the host went away) is a reading state, not a field.
 */
import {
  emptyThreadLifecycle,
  type HarnessThreadSummary,
  type Machine,
  type MachineSession,
  type Reading,
  type Seed,
  emptyThreadHead,
} from "@pe/agent-contracts";
import type {
  DocumentInfo,
  RecentDocument,
  SessionShape,
  UpdatePlan,
  UpdateReceipt,
  UpdateRevit,
} from "@pe/host-contracts/pe-revit-contract";

import type { OpenReading } from "#/open/manifest";

const AT = "2026-10-08T17:12:00.000Z";
const STARTED = "2026-10-08T14:10:00.000Z";
const REGISTRY = "C:\\Users\\demo\\AppData\\Local\\pe-revit";
const exe = (year: number) => `C:\\Program Files\\Autodesk\\Revit ${year}\\Revit.exe`;
const read = { observedAtUtc: AT, attemptedAtUtc: AT, error: null };
/** The SDK doc list's native facts when the seed does not say: unread, as a failed native read. */
const unreadFacts = {
  isWorkshared: null,
  isDetached: null,
  isCloud: null,
  centralPath: null,
  region: null,
  projectGuid: null,
  modelGuid: null,
} as const;

const shape = (over: Partial<SessionShape>): SessionShape => ({
  payload: "installed",
  posture: "foreground",
  purpose: "interactive",
  quarantine: false,
  reload: "none",
  ...over,
});

const doc = (
  title: string,
  path: string,
  over: Partial<DocumentInfo> & { openId: string },
): DocumentInfo => ({
  centralFreshnessAtObservation: null,
  centralPath: null,
  isActive: false,
  isCloud: false,
  isDetached: false,
  isFamily: false,
  isModified: false,
  isWorkshared: false,
  modelGuid: null,
  observedAtUtc: AT,
  path,
  persistence: "local",
  projectGuid: null,
  region: null,
  supportedActions: null,
  title,
  window: null,
  ...over,
});

const TOWER = doc("project-a Tower.rvt", "cld://US/{p-a}/{tower}project-a Tower.rvt", {
  openId: "2501-tower",
  isActive: true,
  isCloud: true,
  isModified: true,
  isWorkshared: true,
  persistence: "cloud",
});
const SHELL = doc("project-a Shell.rvt", "C:\\Models\\project-a Shell.rvt", {
  openId: "2501-shell",
});

/** A checkout Revit this checkout's dev session controls, hot reload, one unsaved cloud model. */
export const CHECKOUT_HOT = {
  whose: "you",
  row: {
    case: "controlled-active",
    execution: { allowed: true, code: null, detail: null },
    id: "pe-app-25-main",
    year: 2025,
    detail: "",
    dialogs: null,
    observedAtUtc: AT,
    origin: "pe-revit session start",
    project: "Pe.App",
    worktree: "C:\\Users\\demo\\source\\repos\\Pe.Tools",
    shape: shape({ payload: "checkout", reload: "hot" }),
    process: { executable: exe(2025), pid: 2501, processStartUtc: STARTED },
    receipt: {
      payload: "checkout",
      buildStamp: "main@5470e8c3",
      generationId: "g-0042",
      generationRoot: `${REGISTRY}\\generations\\g-0042`,
      overridePath: null,
      receiptPath: `${REGISTRY}\\sessions\\pe-app-25-main.json`,
    },
    bridge: {
      bridge: "ready",
      documents: [TOWER, SHELL],
      modal: null,
      privateBytes: null,
      queue: null,
      sessionDescriptor: null,
      unresponsive: false,
    },
  },
  attachment: {
    session: "bridge-2501",
    pid: 2501,
    processStartUtcUnixMs: Date.parse(STARTED),
    documentIdentity: "sdk-open-v1",
    documents: null,
  },
  documents: [TOWER, SHELL],
  holdings: null,
  holdingsLeg: { observedAtUtc: null, attemptedAtUtc: null, error: null },
  documentsLeg: read,
} satisfies MachineSession;

/** A Revit someone started from its icon: observed, addressed by pid, documents from doc list. */
export const OBSERVED_ICON: MachineSession = {
  whose: "you",
  row: {
    case: "observed-active",
    execution: { allowed: true, code: null, detail: null },
    year: 2024,
    observedAtUtc: AT,
    shape: shape({}),
    process: { executable: exe(2024), pid: 2402, processStartUtc: STARTED },
    bridge: { bridge: "answering", sessionDescriptor: null },
  },
  attachment: null,
  documents: [
    {
      isActive: true,
      isFamily: false,
      isModified: false,
      openId: "2402-clinic",
      path: "C:\\Models\\Clinic Renovation.rvt",
      sessionId: "2402",
      title: "Clinic Renovation.rvt",
      window: null,
      persistence: null,
      ...unreadFacts,
    },
  ],
  holdings: null,
  holdingsLeg: { observedAtUtc: null, attemptedAtUtc: null, error: null },
  documentsLeg: read,
};

/** A background Revit with add-ins quarantined, still inside its startup window. */
export const BACKGROUND_BOOTING: MachineSession = {
  whose: "you",
  row: {
    case: "controlled-pending",
    execution: { allowed: true, code: null, detail: null },
    id: "pe-app-26-installed",
    year: 2026,
    detail: "Revit is inside its startup window.",
    observedAtUtc: AT,
    origin: "Pe.Tools Open",
    project: null,
    worktree: "",
    shape: shape({ posture: "background", quarantine: true }),
    receipt: {
      payload: "installed",
      generationRoot: `${REGISTRY}\\installed`,
      receiptPath: `${REGISTRY}\\sessions\\pe-app-26-installed.json`,
    },
    attempt: {
      attempt: "launched",
      bridge: { bridge: "missing-endpoint" },
      process: { executable: exe(2026), pid: 2603, processStartUtc: AT },
    },
  },
  attachment: null,
  documents: null,
  holdings: null,
  holdingsLeg: { observedAtUtc: null, attemptedAtUtc: null, error: null },
  documentsLeg: { observedAtUtc: null, attemptedAtUtc: null, error: null },
};

const SESSIONS = [
  {
    ...CHECKOUT_HOT,
    row: {
      ...CHECKOUT_HOT.row,
      shape: shape({}),
      project: null,
      worktree: "C:\\Users\\demo\\AppData\\Local\\Positive Energy\\Pe.Tools",
      receipt: {
        payload: "installed" as const,
        generationRoot: `${REGISTRY}\\installed`,
        receiptPath: `${REGISTRY}\\sessions\\pe-app-25-main.json`,
      },
    },
  },
  OBSERVED_ICON,
  BACKGROUND_BOOTING,
];

const revitOf = (session: MachineSession, blocked: boolean): UpdateRevit => {
  const process =
    session.row.case === "controlled-pending" && session.row.attempt.attempt === "launched"
      ? session.row.attempt.process
      : "process" in session.row
        ? session.row.process
        : null;
  return {
    answering: session.documents !== null,
    blockers:
      blocked && session.documents?.some((document) => document.isModified)
        ? [
            {
              code: "update.modified-cloud-document",
              detail: "project-a Tower.rvt is a modified cloud document; sync or discard it first",
            },
          ]
        : [],
    custody: session.row.case === "observed-active" ? "observed" : "controlled",
    documents: (session.documents ?? []).map((document) => ({
      central: null,
      isModified: document.isModified,
      openId: document.openId,
      path: document.path,
      persistence: document.persistence,
      reopenSource: document.path,
      title: document.title,
    })),
    idle: session.documents !== null,
    modal: null,
    pid: process!.pid,
    processStartUtc: process!.processStartUtc,
    queue: null,
    sessionId: session.row.case === "observed-active" ? null : session.row.id,
    unknown: session.documents === null,
    year: session.row.year,
  };
};

const plan = (sessions: readonly MachineSession[], blocked: boolean): UpdatePlan => {
  const revits = sessions.map((session) => revitOf(session, blocked));
  return {
    available: true,
    blockers: revits.flatMap((revit) => revit.blockers),
    current: "0.7.0",
    installedRoot: "C:\\Users\\demo\\AppData\\Local\\Positive Energy\\Pe.Tools",
    latest: "0.7.1",
    effects: {
      close: revits.map((revit) => ({ pid: revit.pid, processStartUtc: revit.processStartUtc })),
      reopen: revits.flatMap((revit) => revit.documents.map((document) => document.title ?? "")),
      restartYears: [2025],
    },
    feed: "https://releases.positive-energy.example/pe-tools/feed.json",
    msi: {
      name: "Pe.Tools-0.7.1.msi",
      size: 88_604_672,
      digest: "sha256:7f3a",
      url: "https://releases.positive-energy.example/pe-tools/Pe.Tools-0.7.1.msi",
    },
    observedAtUtc: AT,
    planId: "plan-20261008-1712-7f3a",
    product: "Pe.Tools",
    quiet: false,
    revits,
  };
};

const UP_TO_DATE: UpdatePlan = {
  ...plan([], false),
  available: false,
  latest: null,
  msi: null,
  effects: { close: [], reopen: [], restartYears: [] },
  planId: "plan-20261008-1712-0000",
};

const base = (over: Partial<Machine> = {}): Machine => ({
  observedAtUtc: AT,
  host: {
    serviceName: "Pe.Host",
    instanceId: "host-18422",
    version: "0.7.0",
    payload: "installed",
    process: { pid: 18422, processStartUtc: STARTED },
    port: 5180,
    startedBy: "login",
    autostart: "on",
    sourceRoot: null,
    uptimeSeconds: 11_100,
    canonicalUrl: "http://127.0.0.1:5180",
    peers: [],
  },
  revit: { years: [2024, 2025, 2026], sessions: SESSIONS, unclassifiedAttachments: [] },
  update: {
    automatic: true,
    plan: UP_TO_DATE,
    receipt: null,
    requestId: null,
    admittedPlanId: null,
    planLeg: read,
    receiptLeg: { observedAtUtc: null, attemptedAtUtc: null, error: null },
  },
  share: {
    allowRemoteAdministration: true,
    desired: "off",
    state: "off",
    url: "https://office-pc.tail1234.ts.net",
    refusal: null,
    callers: [],
    refused: [],
  },
  providers: [
    {
      id: "claude",
      harness: "claude",
      name: "Claude",
      auth: { kind: "subscription" },
      readiness: { state: "ready" },
      models: [],
      traits: [],
      probedAt: null,
    },
    {
      id: "codex",
      harness: "codex",
      name: "Codex",
      auth: { kind: "subscription" },
      readiness: { state: "refused", step: "signed-in", message: "not signed in" },
      models: [],
      traits: [],
      probedAt: null,
    },
  ],
  access: { guarded: true },
  legs: {
    sessions: read,
    attachments: read,
    host: read,
    years: read,
    providers: read,
    share: read,
  },
  ...over,
});

const ready = (observation: Machine): Reading<Machine> => ({ state: "ready", observation });
const withUpdate = (update: Partial<Machine["update"]>, over: Partial<Machine> = {}) =>
  base({ ...over, update: { ...base().update, ...update } });

const BLOCKED = plan(SESSIONS, true);
const RECEIPT: UpdateReceipt = {
  legs: [
    {
      name: "download",
      status: "ok",
      observedAtUtc: "2026-10-08T17:20:04.000Z",
      detail: null,
      exitCode: null,
    },
    {
      name: "stop:2501",
      status: "ok",
      observedAtUtc: "2026-10-08T17:20:31.000Z",
      detail: "kept 2 documents",
      exitCode: null,
    },
    {
      name: "stop:2402",
      status: "ok",
      observedAtUtc: "2026-10-08T17:20:40.000Z",
      detail: null,
      exitCode: null,
    },
    {
      name: "handoff",
      status: "running",
      observedAtUtc: "2026-10-08T17:20:41.000Z",
      detail: "msiexec started",
      exitCode: null,
    },
  ],
  planId: "plan-20261008-1712-7f3a",
  receiptPath: `${REGISTRY}\\updates\\plan-20261008-1712-7f3a.receipt.json`,
  reopen: ["project-a Tower.rvt", "project-a Shell.rvt", "Clinic Renovation.rvt"],
  requestId: "6c1f0d1e-2b7a-4e0f-9a51-0b6f3c2d7e11",
  restartYears: [2025],
  state: "running",
};
const HANDOFF = withUpdate(
  {
    plan: plan(SESSIONS, false),
    receipt: RECEIPT,
    requestId: RECEIPT.requestId,
    admittedPlanId: RECEIPT.planId,
    receiptLeg: read,
  },
  {
    revit: {
      years: [2024, 2025, 2026],
      sessions: [BACKGROUND_BOOTING],
      unclassifiedAttachments: [],
    },
  },
);

/** An admitted apply, read at a different point of its receipt. */
const receiptAt = (
  state: UpdateReceipt["state"],
  legs: UpdateReceipt["legs"],
  over: Partial<Machine["update"]> = {},
) =>
  withUpdate({
    plan: plan(SESSIONS, false),
    receipt: { ...RECEIPT, state, legs },
    requestId: RECEIPT.requestId,
    admittedPlanId: RECEIPT.planId,
    receiptLeg: read,
    ...over,
  });
const DOWNLOADING = receiptAt("running", [
  {
    name: "download",
    status: "running",
    observedAtUtc: "2026-10-08T17:20:04.000Z",
    detail: "41% of 84 MB",
    exitCode: null,
  },
]);
const FAILED = receiptAt("failed", [
  {
    name: "download",
    status: "failed",
    observedAtUtc: "2026-10-08T17:20:19.000Z",
    detail: "digest mismatch: the download is not the published installer",
    exitCode: 1,
  },
]);
const CHECK_FAILED = withUpdate({
  plan: null,
  planLeg: {
    observedAtUtc: null,
    attemptedAtUtc: AT,
    error: "The update feed did not answer: connection refused",
  },
});

/* ── The patch bay's world: one person's Revit, two of Pea's, recents from 2022 to 2027 ─────── */

const PEA_WORK = "C:\\Users\\demo\\AppData\\Local\\Positive Energy\\Pe.Tools\\pea\\work";
const HOSPITAL = "C:\\Projects\\Hospital\\Hospital-MEP_kaitp.rvt";
const SD_DIFFUSER = "C:\\Families\\SD-Diffuser-24x24.rfa";
const HCB = "C:\\Families\\HCB-48.rfa";
const CHADDS =
  "cld://US/{c0ffee00-0000-4000-8000-000000000001}p/{c0ffee00-0000-4000-8000-000000000002}Chadds-Ford-Coord.rvt";

/** The person's own Revit 2025, started from its icon: Hospital-MEP unsaved, a family beside it. */
export const BAY_YOURS_25: MachineSession = {
  whose: "you",
  row: {
    case: "observed-active",
    execution: { allowed: true, code: null, detail: null },
    year: 2025,
    observedAtUtc: AT,
    shape: shape({}),
    process: { executable: exe(2025), pid: 18244, processStartUtc: STARTED },
    bridge: { bridge: "answering", sessionDescriptor: null },
  },
  attachment: {
    session: "bridge-18244",
    pid: 18244,
    processStartUtcUnixMs: Date.parse(STARTED),
    documentIdentity: "sdk-open-v1",
    documents: null,
  },
  documents: [
    {
      isActive: true,
      isFamily: false,
      isModified: true,
      openId: "18244-hospital",
      path: HOSPITAL,
      sessionId: "18244",
      title: "Hospital-MEP_kaitp.rvt",
      window: null,
      persistence: null,
      ...unreadFacts,
    },
    {
      isActive: false,
      isFamily: true,
      isModified: false,
      openId: "18244-sd",
      path: SD_DIFFUSER,
      sessionId: "18244",
      title: "SD-Diffuser-24x24.rfa",
      window: null,
      persistence: null,
      ...unreadFacts,
    },
  ],
  holdings: null,
  holdingsLeg: { observedAtUtc: null, attemptedAtUtc: null, error: null },
  documentsLeg: read,
};

const peaSession = (
  id: string,
  year: number,
  pid: number,
  documents: DocumentInfo[],
): MachineSession => ({
  whose: "pea",
  row: {
    case: "controlled-active",
    execution: { allowed: true, code: null, detail: null },
    id,
    year,
    detail: "",
    dialogs: null,
    observedAtUtc: AT,
    origin: "Pe.Tools Open",
    project: null,
    worktree: "C:\\Users\\demo\\AppData\\Local\\Positive Energy\\Pe.Tools",
    shape: shape({ posture: "background" }),
    process: { executable: exe(year), pid, processStartUtc: STARTED },
    receipt: {
      payload: "installed",
      generationRoot: `${REGISTRY}\\installed`,
      receiptPath: `${REGISTRY}\\sessions\\${id}.json`,
    },
    bridge: {
      bridge: "ready",
      documents,
      modal: null,
      privateBytes: null,
      queue: null,
      sessionDescriptor: null,
      unresponsive: false,
    },
  },
  attachment: {
    session: `bridge-${pid}`,
    pid,
    processStartUtcUnixMs: Date.parse(STARTED),
    documentIdentity: "sdk-open-v1",
    documents: null,
  },
  documents,
  holdings: null,
  holdingsLeg: { observedAtUtc: null, attemptedAtUtc: null, error: null },
  documentsLeg: read,
});

/** Pea's background Revit 2025, mid-job on its own copy of Hospital-MEP. */
export const BAY_PEA_25 = peaSession("pea-25-schedules", 2025, 22910, [
  doc("Hospital-MEP_kaitp.rvt", `${PEA_WORK}\\7f3a\\Hospital-MEP_kaitp.rvt`, {
    openId: "22910-copy",
    isActive: true,
    isModified: true,
  }),
]);

/** Pea's background Revit 2026, its job done, holding the family it built. */
const BAY_PEA_26 = peaSession("pea-26-hcb", 2026, 23377, [
  doc("HCB-48.rfa", HCB, { openId: "23377-hcb", isActive: true, isFamily: true }),
]);

const BAY_SESSIONS = [BAY_YOURS_25, BAY_PEA_25, BAY_PEA_26];

/** Every machine moment the surfaces must draw, by name. */
export const MACHINE_SEEDS = {
  "patch-bay": ready(
    base({
      revit: { years: [2024, 2025, 2026], sessions: BAY_SESSIONS, unclassifiedAttachments: [] },
    }),
  ),
  "controlled-hot": ready(
    base({
      revit: { years: [2024, 2025, 2026], sessions: [CHECKOUT_HOT], unclassifiedAttachments: [] },
    }),
  ),
  "observed-icon": ready(
    base({
      revit: { years: [2024, 2025, 2026], sessions: [OBSERVED_ICON], unclassifiedAttachments: [] },
    }),
  ),
  "background-booting": ready(
    base({
      revit: {
        years: [2024, 2025, 2026],
        sessions: [BACKGROUND_BOOTING],
        unclassifiedAttachments: [],
      },
    }),
  ),
  "blocked-plan": ready(withUpdate({ plan: BLOCKED })),
  "waiting-plan": ready(withUpdate({ plan: plan(SESSIONS, false) })),
  "receipt-handoff": ready(HANDOFF),
  "update-downloading": ready(DOWNLOADING),
  "update-failed": ready(FAILED),
  "update-check-failed": ready(CHECK_FAILED),
  disconnected: { state: "stale", previous: HANDOFF, reason: "disconnected" },
  "no-revit": ready(
    base({ revit: { years: [2024, 2025, 2026], sessions: [], unclassifiedAttachments: [] } }),
  ),
} satisfies Record<string, Reading<Machine>>;

export type MachineSeed = keyof typeof MACHINE_SEEDS;

const recent = (
  title: string,
  path: string,
  year: number,
  savedYear: number | null,
  over: Partial<RecentDocument> = {},
): RecentDocument => ({
  isCloud: path.startsWith("cld:"),
  modelGuid: null,
  path,
  projectGuid: null,
  rank: 1,
  region: null,
  savedYear,
  savedYearFailure: null,
  title,
  year,
  ...over,
});

/** `doc recents` across every installed year, as the `recents` Reading delivers it. */
export const RECENTS = {
  result: {
    recents: [
      recent("project-a Tower.rvt", TOWER.path!, 2025, 2025),
      recent("Riverside MEP.rvt", "C:\\Models\\Riverside MEP.rvt", 2024, 2024),
      recent("Clinic Renovation.rvt", "C:\\Models\\Clinic Renovation.rvt", 2024, 2024),
      recent("Harbor Lab Central.rvt", "cld://US/{h}/{lab}Harbor Lab Central.rvt", 2026, 2026),
      recent("project-a Shell.rvt", SHELL.path!, 2025, 2025),
      recent("Office Fitout.rvt", "\\\\fs01\\jobs\\2219\\Office Fitout.rvt", 2025, null, {
        savedYearFailure: "file header unreadable",
      }),
      recent("Pier 9 Annex.rvt", "C:\\Models\\Pier 9 Annex.rvt", 2026, 2027),
    ],
  },
};

/** The patch bay's recents: 2022 to 2027, local, UNC and cloud, two held by Revits now. */
export const BAY_RECENTS = {
  result: {
    recents: [
      recent("Hospital-MEP_kaitp.rvt", HOSPITAL, 2025, 2025),
      recent("Clinic-Fitout.rvt", "C:\\Projects\\Clinic\\Clinic-Fitout.rvt", 2025, 2023),
      recent("Chadds-Ford-Coord.rvt", CHADDS, 2025, 2025, {
        region: "US",
        projectGuid: "c0ffee00-0000-4000-8000-000000000001",
        modelGuid: "c0ffee00-0000-4000-8000-000000000002",
      }),
      recent("HCB-48.rfa", HCB, 2026, 2026),
      recent("SD-Diffuser-24x24.rfa", SD_DIFFUSER, 2025, 2025),
      recent("Library-Mech.rvt", "C:\\Projects\\Library\\Library-Mech.rvt", 2024, 2024),
      recent(
        "Warehouse-Retrofit.rvt",
        "C:\\Projects\\Warehouse\\Warehouse-Retrofit.rvt",
        2024,
        2022,
      ),
      recent("Tower-B-MEP.rvt", "cld://US/{t0b0}p/{mep}Tower-B-MEP.rvt", 2026, 2026),
      recent("Stadium-Concourse.rvt", "cld://US/{s7ad}p/{con}Stadium-Concourse.rvt", 2026, 2027),
      recent("Office Fitout.rvt", "\\\\fs01\\jobs\\2219\\Office Fitout.rvt", 2025, null, {
        savedYearFailure: "file header unreadable",
      }),
    ],
  },
};

const thread = (
  id: string,
  title: string,
  ref: { session: string; openId: string },
  activity: HarnessThreadSummary["activity"],
  updatedAt: string,
): HarnessThreadSummary => ({
  id,
  harness: "claude",
  providerId: "claude",
  providerName: "Claude",
  title,
  createdAt: STARTED,
  updatedAt,
  modelId: null,
  lastSeq: activity.lastSeq,
  head: {
    ...emptyThreadHead,
    hostNow: "1970-01-01T00:00:00.000Z",
    grantView: null,
    defaultTarget: { kind: "open", ref },
    revision: 3,
    displayLabel: title,
  },
  lifecycle: emptyThreadLifecycle(),
  activity,
});

/** The thread list the bay reads in a fixture: one grant on the person's document, two Pea jobs. */
export const BAY_THREADS: HarnessThreadSummary[] = [
  thread(
    "t-retag",
    "Retag level 2 diffusers",
    { session: "bridge-18244", openId: "18244-hospital" },
    { state: "idle", pending: 0, lastSeq: 41, message: "12 tags written · receipt r-0912" },
    "2026-10-08T16:48:00.000Z",
  ),
  thread(
    "t-schedules",
    "Schedule cleanup L1-L4",
    { session: "bridge-22910", openId: "22910-copy" },
    { state: "running", pending: 0, lastSeq: 88, message: "Renaming schedule fields 37/140" },
    "2026-10-08T17:11:30.000Z",
  ),
  thread(
    "t-hcb",
    "Build HCB family",
    { session: "bridge-23377", openId: "23377-hcb" },
    {
      state: "idle",
      pending: 0,
      lastSeq: 120,
      message: "22 parameters, 4 connectors, 3 views checked",
    },
    "2026-10-08T16:20:00.000Z",
  ),
];

/** One seed per action key: `refresh` is the only route-level action. */
export const OPEN_SEEDS: Record<"refresh", Seed<object, OpenReading, object>> = {
  refresh: {
    title: "the patch bay: your Revit 2025, two of Pea's, recents 2022 to 2027",
    work: {},
    readings: {
      machine: (MACHINE_SEEDS["patch-bay"] as { observation: Machine }).observation,
      recents: BAY_RECENTS,
    },
    page: {},
  },
};
