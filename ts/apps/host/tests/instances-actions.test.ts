import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { noticeRows } from "../src/notice-feed.ts";
import { testHostInputs, journalAt, callRouteOver } from "./effect-test.ts";
import { Layer, Effect } from "effect";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { existsSync, symlinkSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { instancesSessionSelection } from "@pe/agent-contracts";
import { HOST_CONTEXT_VARIABLE } from "@pe/host-contracts/contracts";
import { bindCommandRuntime } from "../src/command-registry.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";
import { replayAnswer } from "./sdk-replay.ts";
import { machineAcquisition, machineSessionAcquisition, unavailableShare } from "../src/machine.ts";
import { detachedBridge, captureStore, machineOwner } from "./effect-test.ts";
import { bindControl, mintContext } from "../src/control.ts";
import type { ThreadHead } from "@pe/agent-contracts";
import { docListArgv, type SessionObservation } from "@pe/host-contracts/pe-revit-contract";
import { unreadLeg } from "../src/update-reader.ts";
import { crossingOf, contextHeaders } from "./callers.ts";
import { serveRoutes } from "./real-server.ts";
import { acquisitionSessionId, foldAcquisitions } from "../src/acquisition.ts";
import { runSemanticAction } from "../../../packages/mcps/src/shared/action-client.ts";
// Instances owns its SDK transport. These HTTP witnesses expose no bridge attachment or dispatch.
const sdkOnlyBridge = detachedBridge();
vi.mock("../src/acquisition.ts", async (original) => {
  const acquisition = await original<typeof import("../src/acquisition.ts")>();
  return { ...acquisition, foldAcquisitions: vi.fn(acquisition.foldAcquisitions) };
});
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rmdir: vi.fn(fs.rmdir) };
});

test.each(["EBUSY", "EPERM", "ENOTEMPTY"])(
  "cleanup keeps a folder on rmdir %s and still stops its Revit",
  async (code) => {
    const { f, acquired } = await acquisitionSetup();
    let blocked = "";
    vi.mocked(rmdir).mockImplementationOnce(async (path) => {
      blocked = String(path);
      throw Object.assign(Error(code), { code });
    });
    const receipt = await f.admit("instances.cleanup", {
      acquisition: acquired.id,
      unsaved: "discard",
    });
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    expect(f.calls.some((args) => args[0] === "session" && args[1] === "stop")).toBe(true);
    expect((receipt as { result?: { kept: string[] } }).result?.kept).toContain(blocked);
    expect(existsSync(blocked)).toBe(true);
  },
);

test.each(["absolute", "parent", "junction"])(
  "cleanup refuses a tampered %s prune root",
  async (kind) => {
    const { f, acquired, acquisition } = await acquisitionSetup();
    await rm(acquisition.intent.root, { recursive: true });
    const outside = join(f.dir, "outside");
    await mkdir(join(outside, "empty"), { recursive: true });
    let root = outside;
    if (kind === "parent") root = join(f.peaWork, "..", "outside");
    if (kind === "junction") {
      root = join(f.peaWork, "junction");
      await symlink(outside, root, "junction");
    }
    const actual = vi.mocked(foldAcquisitions).getMockImplementation()!;
    vi.mocked(foldAcquisitions).mockImplementation((...args) =>
      actual(...args).map((row) => ({ ...row, intent: { ...row.intent, root } })),
    );
    try {
      const receipt = await f.admit("instances.cleanup", {
        acquisition: acquired.id,
        unsaved: "discard",
      });
      expect(existsSync(join(outside, "empty"))).toBe(true);
      expect((receipt as { result?: { kept: string[] } }).result?.kept).toContain(root);
    } finally {
      vi.mocked(foldAcquisitions).mockImplementation(actual);
    }
  },
);
// K2: deleting the symlinked-ancestor guard must prune the external empty folder.
test("cleanup keeps an acquisition root beneath a junction ancestor", async () => {
  const { f, acquired, acquisition } = await acquisitionSetup();
  await rm(acquisition.intent.root, { recursive: true });
  const target = join(f.dir, "outside");
  const junction = join(f.peaWork, "junction");
  const root = join(junction, "acquisition");
  const externalRoot = join(target, "acquisition");
  const empty = join(externalRoot, "empty");
  const file = join(externalRoot, "stray.txt");
  await mkdir(empty, { recursive: true });
  await writeFile(file, "keep me");
  symlinkSync(target, junction, "junction");
  const actual = vi.mocked(foldAcquisitions).getMockImplementation()!;
  try {
    vi.mocked(foldAcquisitions).mockImplementation((...args) =>
      actual(...args).map((row) => ({ ...row, intent: { ...row.intent, root } })),
    );
    const receipt = await f.admit("instances.cleanup", {
      acquisition: acquired.id,
      unsaved: "discard",
    });
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    expect(existsSync(externalRoot)).toBe(true);
    expect(existsSync(empty)).toBe(true);
    expect(await readFile(file, "utf8")).toBe("keep me");
    expect((receipt as { result?: { kept: string[] } }).result?.kept).toContain(root);
  } finally {
    vi.mocked(foldAcquisitions).mockImplementation(actual);
    unlinkSync(junction);
  }
});
const cleanup: (() => Promise<void>)[] = [];
test.each(["prepare", "run"])(
  "cleanup excludes a temporary file that vanishes before %s",
  async (phase) => {
    let work = "";
    const { f, acquired, acquisition } = await acquisitionSetup(() => {
      if (phase === "run") unlinkSync(work);
    });
    const origin = acquisition.intent.document!.origin;
    if (origin.kind !== "file-copy") throw Error("expected file copy");
    work = origin.work;
    let vanished = false;
    f.census.beforeSdkList = () => {
      if (phase === "prepare" && !vanished) {
        vanished = true;
        unlinkSync(work);
      }
    };
    const receipt = await f.admit("instances.cleanup", {
      acquisition: acquired.id,
      unsaved: "discard",
    });
    expect(receipt.state).toBe("succeeded");
    expect((receipt as { result?: { removed: string[] } }).result?.removed).not.toContain(work);
    if (phase === "prepare") {
      expect(receipt.prepared).toMatchObject({
        state: "ready",
        value: { removals: expect.not.arrayContaining([work]) },
      });
      expect(
        receipt.steps.some(
          (step) =>
            step.key === "acquisition.remove" && (step.input as { to?: string }).to === work,
        ),
      ).toBe(false);
    }
  },
);
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});
const session = { selection: { id: "dev" }, process: originalProcess };
const receiptPath = "C:/receipts/dev.json";
const openId = "a".repeat(32);
/** The value after `flag` in one recorded argv. */
const flag = (argv: readonly string[], name: string) => argv[argv.indexOf(name) + 1];
const shape = (posture: "foreground" | "background") => ({
  payload: "checkout",
  reload: "none",
  posture,
  quarantine: false,
  purpose: "interactive",
});
const execution = { allowed: true, code: null, detail: null };
const controlledRow = (over: Record<string, unknown> = {}) => ({
  case: "controlled-active",
  id: "dev",
  process: originalProcess,
  receipt: { receiptPath },
  shape: shape("foreground"),
  execution,
  ...over,
});
const observed = { selection: { pid: 4242 }, process: { ...originalProcess, pid: 4242 } };
const observedRow = {
  year: 2025,
  observedAtUtc: originalProcess.processStartUtc,
  bridge: { bridge: "answering", sessionDescriptor: null },
  case: "observed-active",
  process: observed.process,
  shape: shape("foreground"),
  execution,
};
const adopted = {
  state: "ok",
  id: "adopted-4242",
  legs: [],
  session: {
    case: "controlled-active",
    id: "adopted-4242",
    process: observed.process,
    receipt: { receiptPath: "C:/receipts/adopted-4242.json" },
  },
};
const adoptionAnswer = {
  result: adopted,
  resolved: { id: adopted.id, pid: 4242, processStartUtc: observed.process.processStartUtc },
};
const startedAnswer = {
  result: { state: "ok", phase: "ready", id: "dev", session: controlledRow() },
};
type Answer =
  | {
      result: unknown;
      exitCode?: number;
      diagnostics?: {
        code: string;
        detail: string;
        fix: null;
      }[];
      resolved?: unknown;
    }
  | Error;
async function setup(
  answer: (args: readonly string[]) => Answer | Promise<Answer>,
  sessionRows: readonly unknown[] = [controlledRow()],
  peaLaunchWitness = false,
) {
  const dir = await mkdtemp(join(tmpdir(), "pe-instances-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const calls: string[][] = [];
  const sdk = async (args: readonly string[]) => {
    calls.push([...args]);
    // The SDK answers a name it no longer lists with `result: {}` (pe-revit 0.1.0-beta.224).
    if (args[0] === "session" && args[1] === "list") {
      if (census.beforeSessionList) await census.beforeSessionList();
      return args.includes("--id") &&
        !sessionRows.some((row) => (row as { id?: string }).id === flag(args, "--id"))
        ? replayAnswer(args, {
            result: {},
            exitCode: 3,
            diagnostics: [
              {
                code: "session.no-match",
                detail: `no session '${flag(args, "--id")}'`,
                fix: "pe-revit session list",
              },
            ],
          })
        : replayAnswer(args, {
            result: {
              state: "ok",
              sessions: sessionRows,
              processReadErrors: [],
              unreadableReceipts: [],
            },
          });
    }
    if (args[0] === "doc" && args[1] === "list") {
      census.beforeSdkList?.();
      const { pid, processStartUtc } =
        census.process ?? (args.includes("--pid") ? observed.process : originalProcess);
      const reply = replayAnswer(args, {
        result: {
          state: "ok",
          documents: census.documents.map((id) => ({
            openId: id,
            title: id,
            isModified: census.modified,
            isFamily: census.family,
          })),
        },
        resolved: { pid, processStartUtc, id: "dev" },
      });
      return reply;
    }
    // The SDK's own rule (DocRoutes.ValidateOpen): unsynced belongs to a cloud source open only.
    const unsyncedMisplaced =
      args[0] === "doc" &&
      args[1] === "open" &&
      args.includes("--unsynced") &&
      (args.includes("--template") || args.includes("--reload") || !/^cld:\/\//i.test(args[2]!));
    const reply: Answer = unsyncedMisplaced
      ? {
          result: { state: "refused" },
          exitCode: 2,
          diagnostics: [
            { code: "doc.bad-body", detail: "unsynced belongs to a cloud open.", fix: null },
          ],
        }
      : peaLaunchWitness && args[0] === "session" && args[1] === "start"
        ? { result: { ...startedAnswer.result, session: sessionRows[0] } }
        : await answer(args);
    if (reply instanceof Error) throw reply;
    return replayAnswer(args, {
      result: reply.result,
      diagnostics: reply.diagnostics ?? [],
      exitCode: reply.exitCode ?? 0,
      resolved: reply.resolved ?? null,
    });
  };
  const owner = journalAt(join(dir, "actions.json"), Date.now);
  cleanup.push(() => owner.close());
  const peaWork = join(dir, "pea-work");
  const deps = { sdk, peaWork };
  const census = {
    documents: [openId],
    reads: 0,
    fail: false,
    /** Native independence facts the SDK census reports for every document; unknown by default. */
    facts: {} as {
      isWorkshared?: boolean;
      isDetached?: boolean;
    },
    /** What `doc list` says about unsaved edits; null is a read that failed. */
    modified: false as boolean | null,
    /** What `doc list` says each document is: a family document, or a project document. */
    family: false,
    /** The bridge snapshot's SDK identity marker; null is a payload that did not attest. */
    identity: "sdk-open-v1" as "sdk-open-v1" | null,
    /** External SDK session-list input can change between successive census reads. */
    beforeCensus: null as null | (() => void | Promise<void>),
    beforeSdkList: null as null | (() => void),
    beforeSessionList: undefined as (() => Promise<void>) | undefined,
    /** The incarnation `doc list` resolves; the default fixture process when null. */
    process: null as null | {
      pid: number;
      processStartUtc: string;
    },
  };
  const update = {
    plan: null,
    receipt: null,
    requestId: null,
    admittedPlanId: null,
    planLeg: unreadLeg(),
    receiptLeg: unreadLeg(),
    automatic: true,
  };
  const machine = machineOwner({
    targets: { targets: () => [], subscribe: () => () => {} },
    actions: () => owner.list(),
    host: async () => {
      throw Error("not needed");
    },
    peers: async () => [],
    years: async () => [],
    providers: async () => ({ providers: [] }),
    share: unavailableShare,
    update: {
      current: () => update,
      refresh: async () => update,
      apply: async () => update,
      automaticPending: () => false,
      announce: () => {},
      setAutomatic: async () => update,
    },
    sessions: async () => {
      await census.beforeCensus?.();
      census.reads++;
      if (census.fail) throw Error("census unavailable");
      return sessionRows.map((row) => {
        const session = row as SessionObservation;
        return session.case === "observed-active"
          ? session
          : {
              ...session,
              observedAtUtc: new Date().toISOString(),
              bridge: {
                bridge: "ready",
                documents: census.documents.map((openId) => ({
                  openId,
                  title: openId,
                  ...census.facts,
                })),
              },
            };
      }) as SessionObservation[];
    },
    holdings: async () => null,
    documents: async (process) => JSON.parse(await sdk(docListArgv({ pid: process.pid }))).result,
    attachments: async () => [
      {
        session: "bridge-dev",
        pid: originalProcess.pid,
        processStartUtcUnixMs: Date.parse(originalProcess.processStartUtc),
        documentIdentity: census.identity,
        documents: census.documents.map((openId) => ({
          session: "bridge-dev",
          openId,
          address: openId,
          title: openId,
          isFamilyDocument: false,
          isActive: false,
        })),
      },
    ],
  });
  bindControl({
    heads: null,
    acquired: machineAcquisition,
    acquiredSession: machineSessionAcquisition,
  });
  cleanup.push(async () => {
    bindControl({ heads: null, acquired: () => null, acquiredSession: () => null });
  });
  let serial = 0;
  let bound = false;
  /** The admission's own answer, with no wait after it. */
  const invoke = async (
    key: string,
    input: Record<string, unknown>,
    actor: "human" | "agent" = "human",
    original?: string,
    id?: string,
  ) => {
    if (!bound) {
      bindCommandRuntime(owner, sdkOnlyBridge, captureStore(join(dir, "captures")), deps, () =>
        Effect.fail(Error("Instances must dispatch through the SDK")),
      );
      bound = true;
    }
    const selection = instancesSessionSelection(input);
    return owner.invoke(
      {
        id: original ?? id ?? `${key}-${++serial}`,
        key,
        target: selection ? { kind: "sdk-session", selection } : { kind: "host" },
        input,
      },
      crossingOf(actor),
    );
  };
  const admit = async (
    key: string,
    input: Record<string, unknown>,
    original?: string,
    actor: "human" | "agent" = "human",
    id?: string,
  ) => owner.wait((await invoke(key, input, actor, original, id)).id);
  /** A file a launch can name, written under the test directory. */
  const file = async (name: string, text: string) => {
    const path = join(dir, name);
    await writeFile(path, Buffer.from(text, "utf16le"));
    return path;
  };
  return { calls, owner, deps, admit, invoke, dir, peaWork, file, census, machine };
}
const into = (id = "dev") => ({ session: { id } });
const newRevit = (over: Record<string, unknown> = {}) => ({
  start: { year: "2025", owner: "you", addins: "on", ...over },
});
const grantedLifetime = { session: "bridge-dev", openId };
/** A head whose one target a human added. */
function grantHead(): ThreadHead {
  return {
    targets: [
      {
        request: { kind: "open", ref: grantedLifetime },
        admission: { revision: 1, at: new Date().toISOString(), via: "local" },
      },
    ],
    revision: 1,
  };
}
test.each(["stop", "restart", "reset"])(
  "Pea %s declares every affected document instead of widening a thread grant",
  async (verb) => {
    const f = await setup(() => ({ result: { state: "ok" } }));
    bindControl({ heads: grantHead });
    f.census.documents = [openId, "b".repeat(32)];
    const row = await f.admit(
      `instances.${verb}`,
      { session, ...(verb === "restart" ? {} : { unsaved: "keep" }) },
      undefined,
      "agent",
    );
    expect(row.state).toBe("succeeded");
    expect(row.effects.filter((effect) => effect.kind === "document")).toHaveLength(2);
  },
);
test.each(["stop", "restart", "reset"])(
  "D3 %s carries the grant when only its lifetime is present",
  async (verb) => {
    const f = await setup(() => ({ result: { state: "ok" } }));
    bindControl({ heads: grantHead });
    const row = await f.admit(
      `instances.${verb}`,
      { session, ...(verb === "restart" ? {} : { unsaved: "keep" }) },
      undefined,
      "agent",
    );
    expect(row).toMatchObject({
      state: "succeeded",
      basis: null,
    });
    expect(f.census.reads).toBeGreaterThanOrEqual(2);
  },
);
test.each(["stop", "restart"])(
  "D3 %s refuses the granted lifetime when the bridge does not attest SDK document identity",
  async (verb) => {
    const f = await setup(() => ({ result: { state: "ok" } }));
    bindControl({ heads: grantHead });
    // Same string on both sides, but no marker: no join, no title/path fallback, no dispatch.
    f.census.identity = null;
    await expect(
      f.admit(
        `instances.${verb}`,
        { session, ...(verb === "restart" ? {} : { unsaved: "keep" }) },
        undefined,
        "agent",
      ),
    ).resolves.toMatchObject({
      state: "failed",
      notDispatched: true,
      refusal: { code: "lifecycle.ungranted-documents" },
    });
    expect(f.calls.every((args) => args[1] === "list")).toBe(true);
  },
);
test.each(["stop", "restart", "reset"])(
  "D3 %s carries empty-user-session only after a fresh empty census",
  async (verb) => {
    const f = await setup(() => ({ result: { state: "ok" } }));
    await f.machine.refresh();
    f.census.documents = [];
    const row = await f.admit(
      `instances.${verb}`,
      { session, ...(verb === "restart" ? {} : { unsaved: "keep" }) },
      undefined,
      "agent",
    );
    expect(row).toMatchObject({ state: "succeeded", basis: { kind: "empty-user-session" } });
    expect(f.census.reads).toBeGreaterThanOrEqual(3);
  },
);
test.each(["start", "open"])(
  "a held Pea %s acquisition admits agent stop only when every document is its own",
  async (verb) => {
    const f = await setup(
      (args) =>
        args[1] === "start"
          ? startedAnswer
          : {
              result:
                args[0] === "doc"
                  ? { state: "ok", document: { openId, path: args[2] } }
                  : { state: "ok" },
            },
      [controlledRow({ shape: shape("background") })],
    );
    const launch = await f.admit(
      `instances.${verb}`,
      verb === "start"
        ? { year: "2025", owner: "pea", addins: "on" }
        : {
            source: await f.file("Independent.rvt", "Worksharing: Not enabled"),
            into: newRevit({ owner: "pea" }),
          },
    );
    expect(launch.state).toBe("succeeded");
    const stop = () => f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent");
    if (verb === "start") {
      // The empty Revit it started: the process acquisition admits it.
      f.census.documents = [];
    } else {
      // Its own detached copy, natively certified: the document acquisition covers it.
      f.census.facts = { isWorkshared: true, isDetached: true };
    }
    const stopped = await stop();
    expect(stopped).toMatchObject({
      state: "succeeded",
      basis: { kind: "acquisition", id: launch.id, scope: { kind: "process" } },
    });
    expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", "stop"]);
    // A user document B opened in the same Revit later is not Pea's: the stop refuses.
    f.census.documents = verb === "start" ? ["b".repeat(32)] : [openId, "b".repeat(32)];
    const next = await stop();
    expect(next.state).toBe("succeeded");
    expect(
      next.effects.some(
        (effect) => effect.kind === "document" && effect.ref.openId === "b".repeat(32),
      ),
    ).toBe(true);
  },
);
test("an agent opens a new copy into the Revit an acquisition started; a reload there stays human", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", document: { openId, path: null } } }),
    [controlledRow({ shape: shape("background") })],
    true,
  );
  const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
  // No acquisition holds this Revit yet: it is yours.
  expect(
    (await f.admit("instances.open", { source, into: into() }, undefined, "agent")).state,
  ).toBe("succeeded");
  await f.admit(
    "instances.start",
    { year: "2025", owner: "pea", addins: "on" },
    undefined,
    "human",
    "pea-launch",
  );
  const copy = await f.admit("instances.open", { source, into: into() }, undefined, "agent");
  expect(copy).toMatchObject({
    basis: { kind: "acquisition", id: "pea-launch", scope: { kind: "process" } },
    result: { acquisition: copy.id, copiedFrom: source },
  });
  expect(
    (
      await f.admit(
        "instances.open",
        { source: openId, reload: true, into: into() },
        undefined,
        "agent",
      )
    ).state,
  ).toBe("succeeded");
});
test("each Pea acquisition starts its own named Revit, never the person's dev session name", async () => {
  // The person's foreground dev session holds the checkout's default name ("dev" here).
  const f = await setup(() => startedAnswer, [controlledRow()]);
  const starts: string[][] = [];
  const acquisitions: string[] = [];
  for (let n = 0; n < 2; n++) {
    const receipt = await f.admit("instances.start", { year: "2025", owner: "pea", addins: "off" });
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    acquisitions.push(receipt.id);
    starts.push(f.calls.filter((argv) => argv[1] === "start").at(-1)!);
  }
  const names = starts.map((argv) => flag(argv, "--id"));
  expect(new Set(names).size).toBe(2);
  expect(names).toEqual(acquisitions.map(acquisitionSessionId));
  expect(names).not.toContain("dev");
  for (const [index, argv] of starts.entries()) {
    expect(names[index]).toMatch(/^pea-[0-9a-f]{32}$/);
    // A checkout admits only one hot-reload session per key; Pea's is a snapshot beside it.
    expect(argv.includes("--snapshot")).toBe(argv.includes("--project"));
  }
});
test("a Pea launch of a workshared model copies first, then opens the copy detached", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", document: { openId } } }),
    [controlledRow({ id: "pea-bg", shape: shape("background") })],
    true,
  );
  await f.admit(
    "instances.start",
    { year: "2025", owner: "pea", addins: "on" },
    undefined,
    "human",
    "pea-launch",
  );
  const source = await f.file("Central.rvt", "Worksharing: Local");
  const before = await readFile(source);
  const receipt = await f.admit("instances.open", { source, into: into("pea-bg") });
  expect(receipt.state).toBe("succeeded");
  const open = f.calls.at(-1)!;
  expect(open[2]!.startsWith(f.peaWork)).toBe(true);
  expect(open).toContain("--detach");
  expect(await readFile(source)).toEqual(before);
  expect(
    (
      receipt as {
        result?: unknown;
      }
    ).result,
  ).toMatchObject({
    opened: open[2],
    copiedFrom: source,
    detached: true,
  });
});
test("Pea refuses, undispatched, a file whose worksharing it cannot read or a source it cannot resolve", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", document: { openId } } }),
    [controlledRow({ id: "pea-bg", shape: shape("background") })],
    true,
  );
  await f.admit(
    "instances.start",
    { year: "2025", owner: "pea", addins: "on" },
    undefined,
    "human",
    "pea-launch",
  );
  const unread = await f.file("Unknown.rvt", "no marker here");
  for (const source of [unread, "recent:Tower.rvt"]) {
    const receipt = await f.admit("instances.open", { source, into: into("pea-bg") });
    expect(receipt).toMatchObject({ state: "failed", notDispatched: true });
  }
  expect(f.calls.some((argv) => argv[0] === "doc" && argv[1] === "open")).toBe(false);
  expect(existsSync(f.peaWork)).toBe(false);
});
test.each(["open", "stop", "restart", "close"])(
  "observed 4242 is adopted by the SDK before %s dispatches by pid with its receipt",
  async (verb) => {
    const f = await setup(
      (args) =>
        args[1] === "start"
          ? adoptionAnswer
          : { result: args[0] === "doc" ? { state: "ok", document: { openId } } : { state: "ok" } },
      [observedRow],
    );
    const input =
      verb === "open"
        ? {
            source: await f.file("Tower.rvt", "Worksharing: Not enabled"),
            into: { session: { pid: 4242 } },
          }
        : {
            session: observed,
            ...(verb === "stop" || verb === "close" ? { unsaved: "keep" } : {}),
            ...(verb === "close"
              ? { document: { source: "sdk", session: { pid: 4242 }, openId } }
              : {}),
          };
    const receipt = await f.admit(`instances.${verb}`, input);
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    expect(receipt.steps[0]).toMatchObject({
      key: `instances.${verb}.adopt`,
      state: "succeeded",
      process: observed.process,
    });
    expect(
      f.calls.filter((args) => args[1] !== "list").map((args) => args.slice(0, 2).join(" ")),
    ).toEqual([
      "session start",
      `${verb === "open" || verb === "close" ? "doc" : "session"} ${verb === "restart" ? "hr" : verb}`,
    ]);
    const adoption = f.calls.find((args) => args[0] === "session" && args[1] === "start")!;
    expect(flag(adoption, "--pid")).toBe("4242");
    expect(flag(adoption, "--request-id")).toBe(receipt.steps[0]!.id);
    expect(adoption).not.toContain("--project");
    expect(adoption).not.toContain("--id");
    const mutation = f.calls.at(-1)!;
    expect(flag(mutation, "--pid")).toBe("4242");
    expect(mutation).not.toContain("--id");
    expect(flag(mutation, "--expect-session")).toBe(adopted.session.receipt.receiptPath);
  },
);
test.each(["resolved-pid", "resolved-start", "session-start", "receipt"])(
  "adoption refuses an invalid %s before the requested mutation",
  async (bad) => {
    const answer = structuredClone(adoptionAnswer);
    if (bad === "resolved-pid") answer.resolved.pid++;
    if (bad === "resolved-start") answer.resolved.processStartUtc = "replacement";
    if (bad === "session-start") answer.result.session.process.processStartUtc = "replacement";
    if (bad === "receipt") answer.result.session.receipt.receiptPath = "absent";
    const f = await setup(() => answer, [observedRow]);
    const receipt = await f.admit("instances.open", {
      source: "C:/Tower.rvt",
      into: { session: { pid: 4242 } },
    });
    expect(receipt.state).not.toBe("succeeded");
    expect(f.calls.some((args) => args[0] === "doc" && args[1] !== "list")).toBe(false);
  },
);
/** An SDK that starts, opens the copy it is given, saves create-only, closes and stops. */
async function acquisitionSetup(beforeClose?: () => void) {
  const row = controlledRow({ shape: shape("background") });
  const f = await setup(
    async (args) => {
      if (args[0] === "session")
        return args[1] === "start" ? startedAnswer : { result: { state: "ok" } };
      if (args[1] === "open")
        return { result: { state: "ok", document: { openId, path: args[2], title: "Tower" } } };
      if (args[1] === "save") {
        if (!args.includes("--out")) return { result: { state: "ok" } };
        // The SDK's own rule (DocCommand.NewOutput): --out names a new file in an existing folder.
        const out = flag(args, "--out")!;
        if (!existsSync(dirname(out)))
          return {
            result: {},
            exitCode: 2,
            diagnostics: [
              {
                code: "doc.bad-invocation",
                detail: `--out parent directory does not exist: '${dirname(out)}'.`,
                fix: null,
              },
            ],
          };
        await writeFile(out, "saved result", { flag: "wx" });
        return { result: { state: "ok" } };
      }
      if (args[1] === "close") {
        beforeClose?.();
        f.census.documents = f.census.documents.filter((id) => id !== flag(args, "--doc"));
        return { result: { state: "ok" } };
      }
      return Error(`unexpected ${args.join(" ")}`);
    },
    [row],
  );
  f.census.facts = { isWorkshared: false, isDetached: false };
  const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
  const acquired = await f.admit(
    "instances.open",
    { source, into: newRevit({ owner: "pea" }) },
    undefined,
    "agent",
  );
  expect(acquired.state).toBe("succeeded");
  await f.machine.refresh();
  const [acquisition] = foldAcquisitions(await f.owner.list());
  return { f, source, acquired, acquisition: acquisition! };
}
test("handover saves the acquired copy to its create-only result with a diff plan; cleanup keeps it and stops only its own Revit", async () => {
  const { f, source, acquired, acquisition } = await acquisitionSetup();
  const intent = acquisition.intent.document!;
  const handed = await f.admit(
    "instances.handover",
    { acquisition: acquired.id },
    undefined,
    "agent",
  );
  expect(handed).toMatchObject({
    state: "succeeded",
    basis: { kind: "acquisition", id: acquired.id, scope: { kind: "document" } },
    result: { result: { path: intent.result }, diffPlan: intent.diffPlan },
  });
  const save = f.calls.find((argv) => argv[1] === "save")!;
  expect(flag(save, "--out")).toBe(intent.result);
  expect(handed.steps.find((step) => step.kind === "native")?.process).toEqual(originalProcess);
  expect(flag(save, "--release")).toBe("none");
  expect(save).not.toContain("--central");
  const plan = JSON.parse(await readFile(intent.diffPlan, "utf8"));
  expect(plan).toMatchObject({
    baseline: {
      path: (
        intent.origin as {
          baseline: string;
        }
      ).baseline,
    },
    domain: { state: "unknown" },
  });
  expect(plan.baseline.sha256).toBe(acquisition.baseline!.sha256);
  // A result is create-only: a second handover refuses before anything dispatches.
  await expect(
    f.admit("instances.handover", { acquisition: acquired.id }, undefined, "agent"),
  ).resolves.toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { code: "acquisition.unproven" },
  });
  // Unsaved edits no handover saved: keep refuses, undispatched; discard is the explicit choice.
  f.census.modified = true;
  expect(
    await f.admit(
      "instances.cleanup",
      { acquisition: acquired.id, unsaved: "keep" },
      undefined,
      "agent",
    ),
  ).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { code: "acquisition.changed-after-handover" },
  });
  // Discarding unsaved changes on a project document is the person's act (ADR 0038 guard 2).
  expect(
    await f.admit(
      "instances.cleanup",
      { acquisition: acquired.id, unsaved: "discard" },
      undefined,
      "agent",
    ),
  ).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "held", act: "overwrite-or-discard" },
  });
  const cleaned = await f.admit(
    "instances.cleanup",
    { acquisition: acquired.id, unsaved: "discard" },
    undefined,
    "human",
  );
  const work = (
    intent.origin as {
      work: string;
    }
  ).work;
  expect(cleaned).toMatchObject({
    state: "succeeded",
    basis: { kind: "human" },
    result: {
      closed: openId,
      removed: [work],
      stopped: { pid: originalProcess.pid, processStartUtc: originalProcess.processStartUtc },
    },
  });
  expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", "stop"]);
  for (const step of cleaned.steps.filter((step) => step.kind === "native"))
    expect(step.process).toEqual(originalProcess);
  expect(existsSync(work)).toBe(false);
  // The handover's result, its diff plan and the baseline it compares against are kept.
  for (const kept of [
    intent.result,
    intent.diffPlan,
    (
      intent.origin as {
        baseline: string;
      }
    ).baseline,
  ])
    expect(existsSync(kept)).toBe(true);
  expect(await readFile(source, "utf16le")).toBe("Worksharing: Not enabled");
  expect(foldAcquisitions(await f.owner.list())[0]!.state).toBe("released");
  await expect(
    f.admit(
      "instances.cleanup",
      { acquisition: acquired.id, unsaved: "discard" },
      undefined,
      "agent",
    ),
  ).resolves.toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { code: "acquisition.unproven" },
  });
});
/**
 * R6 (acceptance 2026-10-13): a Save As moves the open document to its new file; the lifetime
 * stays the acquisition's, and the new file is a receipted artifact of it that cleanup keeps.
 */
test("a Save As of an acquired document records its new file as the acquisition's artifact", async () => {
  const { f, acquired } = await acquisitionSetup();
  const out = join(f.dir, "Tower-saveas.rvt");
  const saved = await f.admit(
    "instances.save",
    { session, document: sdkDocument, to: { kind: "save-as", out } },
    undefined,
    "agent",
  );
  expect(saved.state).toBe("succeeded");
  expect(flag(f.calls.find((argv) => argv[1] === "save")!, "--out")).toBe(out);
  expect(saved.steps.at(-1)).toMatchObject({
    kind: "file",
    key: "acquisition.artifact",
    state: "succeeded",
    input: { acquisition: acquired.id, to: out },
    result: { path: out, bytes: "saved result".length },
  });
  const [acquisition] = foldAcquisitions(await f.owner.list());
  expect(acquisition).toMatchObject({
    state: "held",
    document: { sdkOpenId: openId },
    artifacts: [{ path: out, bytes: "saved result".length }],
  });
  // A save in place moves nothing: no artifact step. (The person's: Pea's would be held.)
  const inPlace = await f.admit(
    "instances.save",
    { session, document: sdkDocument, to: { kind: "self" } },
    undefined,
    "human",
  );
  expect(inPlace.steps.map((step) => step.key)).toEqual(["instances.save"]);
  const cleaned = await f.admit(
    "instances.cleanup",
    { acquisition: acquired.id, unsaved: "discard" },
    undefined,
    "agent",
  );
  expect(cleaned.state).toBe("succeeded");
  expect(existsSync(out)).toBe(true);
});
test.each([false, true])(
  "keep refuses saved changes after handover even when the document is closed=%s",
  async (closed) => {
    const { f, acquired, acquisition } = await acquisitionSetup();
    const work = (
      acquisition.intent.document!.origin as {
        work: string;
      }
    ).work;
    // A work copy may already differ from baseline when handed over; that saved state is retainable.
    await writeFile(work, "edits before handover");
    expect(
      await f.admit("instances.handover", { acquisition: acquired.id }, undefined, "agent"),
    ).toMatchObject({ state: "succeeded" });
    await writeFile(work, "saved edits after handover");
    if (closed) f.census.documents = [];
    const before = f.calls.length;
    expect(
      await f.admit(
        "instances.cleanup",
        { acquisition: acquired.id, unsaved: "keep" },
        undefined,
        "agent",
      ),
    ).toMatchObject({
      state: "failed",
      notDispatched: true,
      refusal: { code: "acquisition.changed-after-handover" },
    });
    expect(f.calls.slice(before).every((argv) => argv[1] === "list")).toBe(true);
    expect(await readFile(work, "utf8")).toBe("saved edits after handover");
    // Restoring the exact handover state proves this check compares against handover, not baseline/result.
    await writeFile(work, "edits before handover");
    expect(
      await f.admit(
        "instances.cleanup",
        { acquisition: acquired.id, unsaved: "keep" },
        undefined,
        "agent",
      ),
    ).toMatchObject({ state: "succeeded" });
  },
);
test("cleanup names only its own acquisition: a foreign id refuses, a user document B is never closed and keeps the Revit", async () => {
  const { f, acquired, acquisition } = await acquisitionSetup();
  await expect(
    f.admit(
      "instances.cleanup",
      { acquisition: "someone-else", unsaved: "discard" },
      undefined,
      "agent",
    ),
  ).resolves.toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { code: "acquisition.unproven" },
  });
  const userB = "b".repeat(32);
  f.census.documents = [openId, userB];
  const kept = await f.admit(
    "instances.cleanup",
    { acquisition: acquired.id, unsaved: "discard" },
    undefined,
    "agent",
  );
  const origin = acquisition.intent.document!.origin as {
    work: string;
    baseline: string;
  };
  expect(kept).toMatchObject({
    state: "incomplete",
    error: expect.stringContaining("1 other document(s) are open there"),
  });
  const closes = f.calls.filter((argv) => argv[1] === "close");
  expect(closes.map((argv) => flag(argv, "--doc"))).toEqual([openId]);
  expect(f.calls.some((argv) => argv[1] === "stop")).toBe(false);
  // No handover: the baseline is temporary too.
  expect([existsSync(origin.work), existsSync(origin.baseline)]).toEqual([false, false]);
  expect(foldAcquisitions(await f.owner.list())[0]!.state).toBe("held");
  // Once the person closes B, a new cleanup stops the Revit it started, and nothing else.
  f.census.documents = [];
  const stopped = await f.admit(
    "instances.cleanup",
    { acquisition: acquired.id, unsaved: "discard" },
    undefined,
    "agent",
  );
  // A new action: the first cleanup already closed the work copy, so this one only stops.
  expect(stopped, JSON.stringify(stopped)).toMatchObject({
    state: "succeeded",
    result: { closed: null },
  });
  expect(f.calls.filter((argv) => argv[1] === "close")).toHaveLength(1);
  expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", "stop"]);
});
/** The SDK's `op result` for an op whose recorded process died before it settled (op.process-dead). */
const abandonedOp = (
  requestId: string,
  key: string,
  process: {
    pid: number;
  },
): Answer => ({
  result: {
    state: "abandoned",
    requestId,
    receipt: { requestId, key, pid: process.pid, verdict: "started", responsePath: null },
  },
  exitCode: 1,
  diagnostics: [
    {
      code: "op.process-dead",
      detail: `pid ${process.pid} is gone; it can never complete.`,
      fix: null,
    },
  ],
});
/**
 * A fake pe-revit for Pea's own Revit across a crash of our host (acceptance R4b, W2 20). `session
 * start --id` mints a new Revit under that id and enforces the SDK's expectation rule
 * (MutationGate.CheckSession: `absent` only with no row, else that row's descriptor); `doc open`
 * into a dead Revit answers `doc.bridge-unreachable`; `die()` kills every Revit, leaving the
 * gone-receipt rows the SDK lists; `crash` loses the next call of that verb with our host.
 */
async function crashWorld() {
  const rows: Record<string, unknown>[] = [];
  const world = {
    starts: [] as string[][],
    opens: [] as string[][],
    crash: null as null | "start" | "open",
    ops: {} as Record<string, Answer>,
    pid: 100,
  };
  const row = (id: string) =>
    rows.find((each) => each.id === id) as
      | {
          case: string;
          process: typeof originalProcess;
          receipt: {
            receiptPath: string;
          };
        }
      | undefined;
  const f = await setup((args) => {
    if (args[0] === "op")
      return (
        world.ops[args[2]!] ?? {
          result: { state: "refused", requestId: args[2] },
          diagnostics: [{ code: "op.unknown-request", detail: "No receipt exists", fix: null }],
        }
      );
    const verb = args[1];
    if (verb === "start" || verb === "open") {
      (verb === "start" ? world.starts : world.opens).push([...args]);
      if (world.crash === verb) {
        world.crash = null;
        return Error("our host died with its pe-revit child");
      }
    }
    const named = row(flag(args, "--id")!);
    if (verb === "start") {
      const id = flag(args, "--id")!;
      if (flag(args, "--expect-session") !== (named?.receipt.receiptPath ?? "absent"))
        return {
          result: { state: "refused", legs: [] },
          exitCode: 2,
          diagnostics: [{ code: "op.stale-expectation", detail: "expectation", fix: null }],
        };
      if (named) rows.splice(rows.indexOf(named), 1);
      const process = { ...originalProcess, pid: ++world.pid };
      const session = controlledRow({
        id,
        process,
        receipt: { receiptPath: `C:/receipts/${id}-${process.pid}.json` },
        shape: shape("background"),
      });
      rows.push(session);
      return { result: { state: "ok", phase: "ready", id, session } };
    }
    if (verb === "open")
      return named?.case === "controlled-active"
        ? { result: { state: "ok", document: { openId, path: args[2], title: "Tower" } } }
        : {
            result: { state: "failed" },
            exitCode: 1,
            diagnostics: [{ code: "doc.bridge-unreachable", detail: "gone", fix: null }],
          };
    if (verb === "close") {
      f.census.documents = f.census.documents.filter((each) => each !== flag(args, "--doc"));
      return { result: { state: "ok", document: null } };
    }
    if (verb === "stop" && named) {
      rows[rows.indexOf(named)] = { ...named, case: "gone-receipt" };
      return { result: { state: "ok", id: flag(args, "--id"), phase: "stopped" } };
    }
    return Error(`unexpected ${args.join(" ")}`);
  }, rows);
  const die = () => rows.forEach((each, i) => (rows[i] = { ...each, case: "gone-receipt" }));
  const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
  return { f, world, rows, row, die, input: { source, into: newRevit({ owner: "pea" }) } };
}
test("K1b boot asks an unknown host-target instances.open once, with no bridge, and it settles from the answer", async () => {
  const { f, world, row, die, input } = await crashWorld();
  world.crash = "open";
  const lost = await f.admit("instances.open", input);
  expect(lost).toMatchObject({ target: { kind: "host" }, state: "unknown" });
  const open = lost.steps.at(-1)!;
  const revit = row(acquisitionSessionId(lost.id))!.process;
  die();
  world.ops[open.id] = abandonedOp(open.id, "doc.open", revit);
  const reads = () => f.calls.filter((argv) => argv[0] === "op" && argv[1] === "result").length;
  const before = reads();
  await f.owner.reconcile();
  const settled = (await f.owner.list(undefined, lost.id))[0]!;
  expect(settled.steps.at(-1)).toMatchObject({ key: "instances.open", state: "failed" });
  expect(settled.state).not.toBe("unknown");
  expect(reads() - before).toBe(1);
  await f.owner.reconcile();
  expect(reads() - before).toBe(1);
});
test("W2 20 (c): an open whose Revit died is not done, and cleanup releases what is left", async () => {
  const { f, world, row, die, input } = await crashWorld();
  world.crash = "open";
  const lost = await f.admit("instances.open", input);
  const open = lost.steps.at(-1)!;
  const revit = row(acquisitionSessionId(lost.id))!.process;
  die();
  world.ops[open.id] = abandonedOp(open.id, "doc.open", revit);
  const recovered = await f.owner.recover(lost.id);
  expect(recovered.steps.at(-1)).toMatchObject({ state: "failed" });
  expect(recovered.steps.at(-1)).not.toHaveProperty("notDispatched");
  const [acquisition] = foldAcquisitions(await f.owner.list());
  expect(acquisition).toMatchObject({ state: "held", document: null });
  const before = f.calls.length;
  const cleaned = await f.admit(
    "instances.cleanup",
    { acquisition: lost.id, unsaved: "discard" },
    undefined,
    "agent",
  );
  const origin = acquisition!.intent.document!.origin as {
    work: string;
    baseline: string;
  };
  expect(cleaned, JSON.stringify(cleaned)).toMatchObject({
    state: "succeeded",
    result: { closed: null, removed: [origin.work, origin.baseline], stopped: null },
  });
  // Nothing to close or stop: the dead Revit took its lifetime with it.
  expect(f.calls.slice(before).filter((argv) => argv[1] !== "list")).toEqual([]);
  expect(foldAcquisitions(await f.owner.list())[0]!.state).toBe("released");
});
test.each(["running", "missing-response", "wrong-request", "wrong-key", "conflicting-state"])(
  "a lost supervisor with %s evidence stays unknown and never re-dispatches",
  async (mode) => {
    const f = await setup((args) => {
      if (args[0] !== "op") return Error("lost response");
      const result = {
        state: mode === "running" ? "running" : "ok",
        requestId: mode === "wrong-request" ? "foreign" : args[2],
        receipt: {
          requestId: args[2],
          key: mode === "wrong-key" ? "session.stop" : "session.start",
          verdict: "ok",
        },
        response:
          mode === "missing-response"
            ? null
            : JSON.parse(
                sdkEnvelope({ state: mode === "conflicting-state" ? "failed" : "ok", legs: [] }),
              ),
      };
      return { result };
    }, []);
    const lost = await f.admit("instances.start", { year: "2025", owner: "you", addins: "on" });
    const settled = await f.owner.recover(lost.id);
    expect(settled.steps[0]!.state).toBe("unknown");
    expect(f.calls.at(-1)).toEqual(["op", "result", lost.steps[0]!.id, "--json"]);
    expect(f.calls.filter((args) => args[1] === "start")).toHaveLength(1);
  },
);
test("restart, stop and close run for a human; stop and close require an unsaved choice", async () => {
  const f = await setup((args) =>
    args[0] === "session"
      ? { result: { id: "dev", state: "ok", phase: args[1] === "stop" ? "stopped" : "ready" } }
      : { result: { state: "ok", document: { openId } } },
  );
  const document = { source: "sdk", session: { id: "dev" }, openId };
  for (const key of ["instances.stop", "instances.close"])
    await expect(f.admit(key, { session, document })).rejects.toThrow();
  expect(f.calls).toEqual([]);
  await expect(f.admit("instances.restart", { session, unsaved: "keep" })).rejects.toThrow();
  expect(f.calls).toEqual([]);
  expect((await f.admit("instances.restart", { session }, undefined, "human")).state).toBe(
    "succeeded",
  );
  const restart = f.calls.at(-1)!;
  expect(restart.slice(0, 2)).toEqual(["session", "hr"]);
  expect(restart).toContain("--restart");
  expect(restart).not.toContain("--unsaved");
  expect(flag(restart, "--expect-session")).toBe(receiptPath);
  expect(
    (await f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "human")).state,
  ).toBe("succeeded");
  const stop = f.calls.at(-1)!;
  expect(stop.slice(0, 4)).toEqual(["session", "stop", "--id", "dev"]);
  expect(flag(stop, "--unsaved")).toBe("keep");
  const close = await f.admit(
    "instances.close",
    { session, document, unsaved: "keep" },
    undefined,
    "human",
  );
  expect(close.state).toBe("succeeded");
  const closeArgv = f.calls.at(-1)!;
  expect(closeArgv.slice(0, 4)).toEqual(["doc", "close", "--doc", openId]);
  expect(flag(closeArgv, "--unsaved")).toBe("keep");
  expect(flag(closeArgv, "--expect-doc")).toBe(openId);
});
test("a document arriving after admission refuses stop at effect entry", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }));
  f.census.documents = [];
  let reads = 0;
  f.census.beforeCensus = () => {
    if (++reads === 2) f.census.documents = [openId];
  };
  expect(
    await f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent"),
  ).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: expect.objectContaining({ kind: "stale" }),
  });
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
});
test("a user document opened in Pea's Revit after admission refuses Pea's stop at effect entry", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }), [controlledRow()], true);
  await f.admit(
    "instances.start",
    { year: "2025", owner: "pea", addins: "on" },
    undefined,
    "human",
    "pea-launch",
  );
  expect(f.calls.filter((args) => args[1] === "start")).toHaveLength(1);
  const beforeStop = f.calls.length;
  f.census.documents = [];
  let reads = 0;
  f.census.beforeCensus = () => {
    if (++reads === 2) f.census.documents = [openId];
  };
  expect(
    await f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent"),
  ).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: expect.objectContaining({ kind: "stale" }),
  });
  expect(f.calls.slice(beforeStop).every((args) => args[1] === "list")).toBe(true);
});
const sdkDocument = { source: "sdk", session: session.selection, openId } as const;
test("an agent save is one document crossing: the granted lifetime admits, another refuses", async () => {
  const f = await setup(() => ({ result: { state: "ok", document: { openId } } }));
  bindControl({ heads: grantHead });
  f.census.documents = [openId, "b".repeat(32)];
  // A Save As: Pea's save in place over a project document is held (the guard tests below).
  const input = {
    session,
    document: sdkDocument,
    to: { kind: "save-as", out: join(f.dir, "copy-a.rvt") },
  };
  expect(await f.admit("instances.save", input, undefined, "agent")).toMatchObject({
    state: "succeeded",
    basis: null,
  });
  expect(
    (
      await f.admit(
        "instances.save",
        {
          ...input,
          document: { ...sdkDocument, openId: "b".repeat(32) },
          to: { kind: "save-as", out: join(f.dir, "copy-b.rvt") },
        },
        undefined,
        "agent",
      )
    ).state,
  ).toBe("succeeded");
});
test("/actions/cancel stops a running Instances step through the SDK op cancel, never the Revit bridge", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const f = await setup(async (args) => {
    if (args[0] === "op") return { result: { state: "ok" } };
    await held;
    return { result: { state: "cancelled" } };
  });
  const server = await serveRoutes(
    callRouteOver(f.owner, captureStore(join(f.dir, "captures")), f.deps).pipe(
      Layer.provide(testHostInputs),
    ),
    sdkOnlyBridge,
  );
  cleanup.push(async () => {
    release();
    await server.close();
  });
  const headers = {
    "content-type": "application/json",
    ...contextHeaders(),
  };
  const admitted = await fetch(`${server.base}/actions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: "save-held",
      key: "instances.save",
      target: { kind: "sdk-session", selection: session.selection },
      input: {
        session,
        document: sdkDocument,
        to: { kind: "self" },
      },
    }),
  });
  expect(admitted.status).toBe(202);
  const row = (await admitted.json()) as { id: string };
  while (!f.calls.some((args) => args[1] === "save")) await new Promise((r) => setTimeout(r, 5));
  const step = (await f.owner.list(undefined, row.id))[0]!.steps.at(-1)!;
  const response = await fetch(`${server.base}/actions/cancel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...contextHeaders(),
    },
    body: JSON.stringify({ id: row.id }),
  });
  expect(response.status).toBe(202);
  expect(f.calls.at(-1)).toEqual(["op", "cancel", step.id, "--json"]);
  release();
  expect((await f.owner.wait(row.id)).state).toBe("cancelled");
});
test("K3: /actions/cancel answers 200 when nothing was signalled to Revit; the Stop still fences the step", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const f = await setup(async (args) => {
    if (args[0] === "op") return { result: { state: "ok" } };
    if (args[1] === "save") await held;
    return { result: { state: "ok" } };
  });
  const server = await serveRoutes(
    callRouteOver(f.owner, captureStore(join(f.dir, "captures")), f.deps).pipe(
      Layer.provide(testHostInputs),
    ),
    sdkOnlyBridge,
  );
  cleanup.push(async () => {
    release();
    await server.close();
  });
  const headers = { "content-type": "application/json", ...contextHeaders() };
  const save = (id: string) =>
    fetch(`${server.base}/actions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id,
        key: "instances.save",
        target: { kind: "sdk-session", selection: session.selection },
        input: { session, document: sdkDocument, to: { kind: "self" } },
      }),
    });
  expect((await save("save-first")).status).toBe(202);
  while (!f.calls.some((args) => args[1] === "save")) await new Promise((r) => setTimeout(r, 5));
  // The second save waits for its turn behind the first: running, with no step sent anywhere.
  const second = await save("save-second");
  const waiting = (await f.owner.list(undefined, "save-second"))[0]!;
  expect([second.status, waiting.state, waiting.steps.length], JSON.stringify(waiting)).toEqual([
    202,
    "running",
    0,
  ]);
  const response = await fetch(`${server.base}/actions/cancel`, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: "save-second" }),
  });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    id: "save-second",
    state: "running",
    cancellationRequested: true,
  });
  expect(f.calls.some((args) => args[0] === "op" && args[1] === "cancel")).toBe(false);
  release();
  expect(await f.owner.wait("save-second")).toMatchObject({
    state: "cancelled",
    notDispatched: true,
  });
});
/**
 * R5 (acceptance 2026-10-13): Pea's stop succeeded, then the action client called its own receipt
 * a conflict, because the host records the parsed request (force defaulted) and the client
 * compared it with the raw input. The real client against the real /actions route over HTTP.
 */
test.each([
  ["instances.stop", "stop"],
  ["instances.reset", "reset"],
] as const)(
  "%s that omits a defaulted option reads back its own receipt over HTTP",
  async (key, verb) => {
    const f = await setup(() => ({
      result: { id: "dev", state: "ok", phase: verb === "reset" ? "ready" : "stopped" },
    }));
    const server = await serveRoutes(
      callRouteOver(f.owner, captureStore(join(f.dir, "captures")), { sdk: f.deps.sdk }).pipe(
        Layer.provide(testHostInputs),
      ),
      sdkOnlyBridge,
    );
    cleanup.push(() => server.close());
    // The owner's terminal: its context rides every host call the client makes.
    const prior = process.env[HOST_CONTEXT_VARIABLE];
    process.env[HOST_CONTEXT_VARIABLE] = mintContext({ kind: "human", via: "cli" });
    const row = await runSemanticAction(
      key,
      { session, unsaved: "keep" },
      undefined,
      undefined,
      server.base,
    ).finally(() => {
      if (prior === undefined) delete process.env[HOST_CONTEXT_VARIABLE];
      else process.env[HOST_CONTEXT_VARIABLE] = prior;
    });
    expect(row).toMatchObject({ state: "succeeded", key });
    expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", verb]);
  },
);

/* ── ADR 0038: the host's own doors hold Pea's guarded acts ───────────────────────────── */
// Mutant that turns every held expectation below red: `guards` in src/guards.ts returning `false`
// (the caller check replaced by false). `guards` returning `true` turns the person's rows red, and
// `isProject` returning `true` turns the family rows red.
const guardedDocument = { source: "sdk", session: { id: "dev" }, openId };
const discardDoors: Record<string, Record<string, unknown>> = {
  "instances.stop": { session, unsaved: "discard" },
  "instances.reset": { session, unsaved: "discard" },
  "instances.restart": { session },
  "instances.close": { session, document: guardedDocument, unsaved: "discard" },
};
/** What the SDK was asked to do, the census reads aside. */
const sdkActs = (f: { calls: string[][] }) => f.calls.filter((argv) => argv[1] !== "list");
const guardSetup = async () => {
  const f = await setup((args) =>
    args[0] === "session"
      ? { result: { id: "dev", state: "ok", phase: args[1] === "stop" ? "stopped" : "ready" } }
      : { result: { state: "ok", document: { openId } } },
  );
  bindControl({ heads: grantHead });
  return f;
};
test.each(Object.keys(discardDoors))(
  "guard 2: %s is held at once for Pea over unsaved changes on a project document",
  async (key) => {
    const f = await guardSetup();
    f.census.modified = true;
    // R3: the admission's own answer is the settled receipt. Nothing waited and nothing was dispatched.
    const row = await f.invoke(key, discardDoors[key]!, "agent");
    expect(row).toMatchObject({
      state: "failed",
      notDispatched: true,
      refusal: { kind: "held", act: "overwrite-or-discard" },
    });
    expect("error" in row && row.error).toMatch(/^Held, not done/);
    expect("error" in row && row.error).not.toMatch(/refus|reject|declin|denied/i);
    expect(sdkActs(f)).toEqual([]);
    // An `isModified` that cannot be read is held too.
    f.census.modified = null;
    expect(await f.invoke(key, discardDoors[key]!, "agent")).toMatchObject({
      state: "failed",
      refusal: { kind: "held" },
    });
    expect(sdkActs(f)).toEqual([]);
  },
);
test.each(
  Object.keys(discardDoors).flatMap((key) =>
    (["person", "family document", "saved project document"] as const).map(
      (who) => [key, who] as const,
    ),
  ),
)("guard 2: %s is not held for a %s", async (key, who) => {
  const f = await guardSetup();
  f.census.modified = who !== "saved project document";
  f.census.family = who === "family document";
  const row = await f.admit(
    key,
    discardDoors[key]!,
    undefined,
    who === "person" ? "human" : "agent",
  );
  expect(row.state, JSON.stringify(row)).toBe("succeeded");
  expect(sdkActs(f)).toHaveLength(1);
});
test("guards 1 and 2: Pea's save over a project document is held; a Save As, a family document and the person's save are not", async () => {
  const f = await guardSetup();
  const input = (to: Record<string, unknown>) => ({ session, document: sdkDocument, to });
  // Held whether or not the document is modified: a save writes over the model either way.
  expect(await f.invoke("instances.save", input({ kind: "self" }), "agent")).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "held", act: "overwrite-or-discard" },
  });
  const central = await f.invoke("instances.save", input({ kind: "central" }), "agent");
  expect(central).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "held", act: "synchronize" },
  });
  expect("error" in central && central.error).toMatch(/^Held, not done/);
  expect(sdkActs(f)).toEqual([]);
  // Not held: a Save As to a new path by Pea, and the person's own save and synchronize.
  for (const [to, actor] of [
    [{ kind: "save-as", out: join(f.dir, "new-path.rvt") }, "agent"],
    [{ kind: "self" }, "human"],
    [{ kind: "central" }, "human"],
  ] as const)
    expect((await f.admit("instances.save", input(to), undefined, actor)).state).toBe("succeeded");
  // Not held: Pea saving a family document in place (ADR 0038 rule 3).
  f.census.family = true;
  expect((await f.admit("instances.save", input({ kind: "self" }), undefined, "agent")).state).toBe(
    "succeeded",
  );
  expect(sdkActs(f).filter((argv) => argv[1] === "save")).toHaveLength(4);
});
test("guard 2: Pea's discard cleanup is held over unsaved changes on its open project document; a family document is not", async () => {
  const { f, acquired } = await acquisitionSetup();
  const input = { acquisition: acquired.id, unsaved: "discard" };
  f.census.modified = true;
  const before = sdkActs(f).length;
  expect(await f.invoke("instances.cleanup", input, "agent")).toMatchObject({
    state: "failed",
    notDispatched: true,
    refusal: { kind: "held", act: "overwrite-or-discard" },
  });
  expect(sdkActs(f)).toHaveLength(before);
  f.census.family = true;
  expect((await f.admit("instances.cleanup", input, undefined, "agent")).state).toBe("succeeded");
});

// Mutant: drop the refused-tail branch, so the row reads "incomplete" with no reason or cleanup line.
test("a quarantined launch refused through /actions reads refused in the feed and still waits on cleanup of its local copies", async () => {
  const f = await setup(() => ({
    result: null,
    exitCode: 2,
    diagnostics: [
      {
        code: "session.quarantine-unavailable",
        detail: "Another session holds the quarantine lease.",
        fix: null,
      },
    ],
  }));
  const path = await f.file("refused.rvt", "Worksharing: Not enabled");
  const server = await serveRoutes(
    callRouteOver(f.owner, captureStore(join(f.dir, "captures")), f.deps).pipe(
      Layer.provide(testHostInputs),
    ),
    sdkOnlyBridge,
  );
  cleanup.push(() => server.close());
  const headers = { "content-type": "application/json", ...contextHeaders() };
  const posted = await fetch(`${server.base}/actions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: "quarantine-refused",
      key: "instances.open",
      target: { kind: "host" },
      input: { source: path, into: newRevit({ owner: "pea", addins: "off" }) },
    }),
  });
  expect(posted.status, await posted.clone().text()).toBeLessThan(300);
  const [receipt] = await (
    await fetch(`${server.base}/actions?id=quarantine-refused&wait=10000`, { headers })
  ).json();
  expect(receipt, JSON.stringify(receipt)).toMatchObject({ state: "incomplete" });
  expect(receipt.steps.at(-1)).toMatchObject({ state: "failed", notDispatched: true });
  const rows = noticeRows(
    {
      threads: [],
      works: [],
      machine: null,
      stored: [],
      receipts: [{ revision: 1, action: receipt }],
    },
    Date.now(),
  );
  // Its local copies were made before the refused launch, so the row still waits on cleanup.
  expect(rows).toMatchObject([
    { group: "waits", verb: "refused", says: expect.stringMatching(/quarantine[\s\S]*clean up/) },
  ]);
  // The cleanup line rides on the refused tail itself, not on the receipt carrying an error.
  const { error: _error, ...bare } = receipt;
  const bareRows = noticeRows(
    {
      threads: [],
      works: [],
      machine: null,
      stored: [],
      receipts: [{ revision: 1, action: bare }],
    },
    Date.now(),
  );
  expect(bareRows).toMatchObject([
    { group: "waits", verb: "refused", says: expect.stringMatching(/clean up/) },
  ]);
});

// Mutant: skip removeEmptyAcquisitionRoot; the empty-root assertion must fail.
test.each([false, true])(
  "cleanup through /actions removes empty instance folders and preserves stray files: %s",
  async (stray) => {
    const f = await setup(
      async (args) => {
        if (args[0] === "session")
          return args[1] === "start" ? startedAnswer : { result: { state: "ok" } };
        if (args[1] === "close") f.census.documents = [];
        return { result: { state: "ok", document: { openId, path: args[2] } } };
      },
      [controlledRow({ shape: shape("background") })],
    );
    const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
    const server = await serveRoutes(
      callRouteOver(f.owner, captureStore(join(f.dir, "captures")), f.deps).pipe(
        Layer.provide(testHostInputs),
      ),
      sdkOnlyBridge,
    );
    cleanup.push(() => server.close());
    const opening = await fetch(`${server.base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...contextHeaders() },
      body: JSON.stringify({
        id: "plant",
        key: "instances.open",
        target: { kind: "host" },
        input: { source, into: newRevit({ owner: "pea" }) },
      }),
    });
    expect(opening.status).toBe(202);
    const acquired = await f.owner.wait(((await opening.json()) as { id: string }).id);
    expect(acquired.state, JSON.stringify(acquired)).toBe("succeeded");
    const acquisition = foldAcquisitions(await f.owner.list())[0]!;
    const root = acquisition.intent.root;
    const origin = acquisition.intent.document!.origin;
    if (origin.kind !== "file-copy") throw Error("expected file copy");
    expect(existsSync(origin.work)).toBe(true);
    expect(existsSync(origin.baseline)).toBe(true);
    const extra = join(dirname(origin.work), "stray.txt");
    if (stray) await writeFile(extra, "keep me");
    const response = await fetch(`${server.base}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...contextHeaders() },
      body: JSON.stringify({
        id: "cleanup-folders",
        key: "instances.cleanup",
        target: { kind: "host" },
        input: { acquisition: acquired.id, unsaved: "discard" },
      }),
    });
    expect(response.status).toBe(202);
    const receipt = await f.owner.wait(((await response.json()) as { id: string }).id);
    expect(receipt.state, JSON.stringify(receipt)).toBe("succeeded");
    expect(existsSync(root)).toBe(stray);
    if (!("result" in receipt)) throw Error("cleanup did not return a result");
    const result = receipt.result as { removed: string[]; kept: string[] };
    expect(
      receipt.effects.filter((effect) => effect.kind === "file").map((effect) => effect.path),
    ).toEqual(result.removed);
    expect(JSON.stringify(receipt.effects)).not.toContain(".part");
    if (stray) {
      expect(await readFile(extra, "utf8")).toBe("keep me");
      expect(result.kept).toContain(extra);
      for (const step of receipt.steps) expect(step).not.toHaveProperty("touched");
      const rows = noticeRows(
        {
          threads: [],
          works: [],
          machine: null,
          stored: [],
          receipts: [{ revision: 1, action: receipt }],
        },
        Date.now(),
      );
      expect(rows).toMatchObject([{ detail: expect.stringContaining(`kept: ${extra}`) }]);
    }
  },
);

// K1c option B, shaped like drive1: launch 29d6cc45 succeeded; 55261b6e is the SDK's refusal of a
// same-year start beside a live session. Only a running action holds a claim, so the SDK guards the year.
const beside =
  (rows: unknown[]) =>
  (args: readonly string[]): Answer =>
    args[1] !== "start"
      ? { result: { id: "dev", state: "ok", phase: "stopped" } }
      : rows.length
        ? {
            result: { state: "refused", requestId: flag(args, "--request-id") ?? null, legs: [] },
            exitCode: 2,
            diagnostics: [
              {
                code: "op.stale-expectation",
                detail: "expected no session row, but 'dev' exists. Nothing was dispatched.",
                fix: null,
              },
            ],
          }
        : startedAnswer;
const start2025 = { year: "2025", owner: "you", addins: "on" };

test("K1c: a start beside a live Revit of its year reaches the SDK and fails undispatched, saying so plainly", async () => {
  const rows: unknown[] = [];
  const f = await setup(beside(rows), rows);
  expect(await f.admit("instances.start", start2025)).toMatchObject({ state: "succeeded" });
  rows.push(controlledRow());
  const second = await f.admit("instances.start", start2025);
  expect(second, JSON.stringify(second)).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringMatching(
      /^Revit 2025 already has a session, so nothing was started\. .*'dev' exists/,
    ),
  });
  expect(f.calls.filter((argv) => argv[1] === "start")).toHaveLength(2);
});

test("K1c: once that Revit is gone by any route, a second start of the year runs", async () => {
  const rows: unknown[] = [];
  const f = await setup(beside(rows), rows);
  expect(await f.admit("instances.start", start2025)).toMatchObject({ state: "succeeded" });
  expect(await f.admit("instances.start", start2025)).toMatchObject({ state: "succeeded" });
});

test.each([false, true])(
  "K1c: stopping a Revit that already closed succeeds with historical rows=%s",
  async (history) => {
    const f = await setup(
      () => Error("Unexpected SDK mutation"),
      history
        ? [
            { case: "gone-receipt", id: "dev", process: originalProcess },
            { case: "failed-receipt", id: "older", failure: { source: "receipt" } },
          ]
        : [],
    );
    const stop = await f.admit("instances.stop", { session, unsaved: "discard" });
    expect(stop).toMatchObject({
      state: "succeeded",
      result: { state: "ok", phase: "already-gone" },
    });
    expect(f.calls.every((args) => args[0] === "session" && args[1] === "list")).toBe(true);
  },
);

test("the first Stop accepts three individually responsive reads of an empty Revit", async () => {
  const f = await setup(() => ({ result: { state: "ok", phase: "stopped" } }));
  const entered = Promise.withResolvers<void>();
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 1_100));
  let sdkLists = 0;
  let machineLists = 0;
  f.census.documents = [];
  f.census.beforeSessionList = async () => {
    if (++sdkLists > 2) return;
    const waiting = pause();
    entered.resolve();
    await waiting;
  };
  f.census.beforeCensus = () => {
    if (++machineLists === 1) return pause();
  };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const stopping = f.admit("instances.stop", { session, unsaved: "keep" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(3_301);
    expect(await stopping).toMatchObject({ state: "succeeded" });
    expect(f.calls.at(-1)?.slice(0, 2)).toEqual(["session", "stop"]);
  } finally {
    vi.useRealTimers();
  }
});

test("Stop times out without advising a save when the SDK cannot answer its opening census", async () => {
  const f = await setup(() => Error("Unexpected SDK mutation"));
  const entered = Promise.withResolvers<void>();
  const blocked = Promise.withResolvers<void>();
  f.census.beforeSessionList = () => {
    entered.resolve();
    return blocked.promise;
  };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const stopping = f.admit("instances.stop", { session, unsaved: "keep" });
  try {
    await entered.promise;
    await vi.advanceTimersByTimeAsync(8_001);
    expect(await stopping).toMatchObject({
      state: "failed",
      notDispatched: true,
      error: "Pe couldn’t check this Revit in time. Try again.",
    });
    expect(f.calls.every((args) => args[1] === "list")).toBe(true);
  } finally {
    blocked.resolve();
    vi.useRealTimers();
  }
});

test("Stop refuses another host’s Revit without advising a save", async () => {
  const f = await setup(
    () => Error("Unexpected SDK mutation"),
    [
      controlledRow({
        execution: { allowed: false, code: "runtime.foreign", detail: "Another checkout." },
      }),
    ],
  );
  expect(await f.admit("instances.stop", { session, unsaved: "keep" })).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: "This Revit is outside this host’s scope.",
  });
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
});

test("restart refuses a session the SDK no longer names without dispatching", async () => {
  const f = await setup(() => Error("Unexpected SDK mutation"), []);
  const restart = await f.admit("instances.restart", { session });
  expect(restart).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: "The supplied session incarnation is not the one the SDK records",
  });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]?.slice(0, 4)).toEqual(["session", "list", "--id", "dev"]);
});
