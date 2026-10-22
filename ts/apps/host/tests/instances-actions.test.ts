import { afterEach, expect, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { instancesSessionSelection } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { HOST_CONTEXT_HEADER, HOST_CONTEXT_VARIABLE } from "@pe/host-contracts/contracts";
import { admitInstancesAction, recoverInstancesAction } from "../src/instances-actions.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { RevitBridge } from "../src/bridge.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";
import { replayAnswer } from "./sdk-replay.ts";
import {
  createMachine,
  machineAcquisition,
  machineSessionAcquisition,
  useHostMachine,
  unavailableShare,
} from "../src/machine.ts";
import { bindControl, mintContext } from "../src/control.ts";
import type { ThreadHead } from "@pe/agent-contracts";
import type { SessionObservation } from "@pe/host-contracts/pe-revit-contract";
import { unreadLeg } from "../src/update-reader.ts";
import { crossingOf } from "./callers.ts";
import { serveRoutes } from "./real-server.ts";
import { writeJournal } from "./journal-fixture.ts";
import {
  acquiredOpenIds,
  acquisitionSessionId,
  foldAcquisitions,
  planAcquisition,
} from "../src/acquisition.ts";
import { runSemanticAction } from "../../../packages/mcps/src/shared/takeoff-action-client.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const session = { selection: { id: "dev" }, process: originalProcess };
const receiptPath = "C:/receipts/dev.json";
const openId = "a".repeat(32);
/** The value after `flag` in one recorded argv. */
const flag = (argv: readonly string[], name: string) => argv[argv.indexOf(name) + 1];
const shape = (posture: "foreground" | "background") => ({ posture });
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
      diagnostics?: { code: string; detail: string; fix: null }[];
      resolved?: unknown;
    }
  | Error;
async function setup(
  answer: (args: readonly string[]) => Answer | Promise<Answer>,
  sessionRows: readonly unknown[] = [controlledRow()],
) {
  const dir = await mkdtemp(join(tmpdir(), "pe-instances-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const calls: string[][] = [];
  const sdk = async (args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === "session" && args[1] === "list")
      return replayAnswer(args, { result: { state: "ok", sessions: sessionRows } });
    if (args[0] === "doc" && args[1] === "list") {
      const { pid, processStartUtc } =
        census.process ?? (args.includes("--pid") ? observed.process : originalProcess);
      return replayAnswer(args, {
        result: {
          state: "ok",
          documents: census.documents.map((id) => ({ openId: id, isModified: census.modified })),
        },
        resolved: { pid, processStartUtc, id: "dev" },
      });
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
      : await answer(args);
    if (reply instanceof Error) throw reply;
    return replayAnswer(args, {
      result: reply.result,
      diagnostics: reply.diagnostics ?? [],
      exitCode: reply.exitCode ?? 0,
      resolved: reply.resolved ?? null,
    });
  };
  const owner = new ActionJournal(join(dir, "actions.json"));
  const peaWork = join(dir, "pea-work");
  const deps = { sdk, peaWork };
  const census = {
    documents: [openId],
    reads: 0,
    fail: false,
    /** Native independence facts the SDK census reports for every document; unknown by default. */
    facts: {} as { isWorkshared?: boolean; isDetached?: boolean },
    /** What `doc list` says about unsaved edits. */
    modified: false,
    /** The bridge snapshot's SDK identity marker; null is a payload that did not attest. */
    identity: "sdk-open-v1" as "sdk-open-v1" | null,
    /** The incarnation `doc list` resolves; the default fixture process when null. */
    process: null as null | { pid: number; processStartUtc: string },
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
  const machine = createMachine({
    targets: { targets: () => [], subscribe: () => () => {} },
    actions: () => owner.list(),
    host: async () => {
      throw Error("not needed");
    },
    peers: async () => [],
    years: async () => [],
    providers: async () => ({ providers: [], access: { guarded: true } }),
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
      census.reads++;
      if (census.fail) throw Error("census unavailable");
      return sessionRows.map((row) => ({
        ...(row as SessionObservation),
        observedAtUtc: new Date().toISOString(),
        bridge: {
          bridge: "ready",
          documents: census.documents.map((openId) => ({
            openId,
            title: openId,
            ...census.facts,
          })),
        },
      })) as SessionObservation[];
    },
    holdings: async () => null,
    documents: async () => ({ state: "ok", documents: [] }),
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
  useHostMachine(machine);
  bindControl({
    heads: null,
    acquired: machineAcquisition,
    acquiredSession: machineSessionAcquisition,
  });
  cleanup.push(async () => {
    useHostMachine(undefined);
    machine.close();
    bindControl({ heads: null, acquired: () => null, acquiredSession: () => null });
  });
  let serial = 0;
  const admit = async (
    key: string,
    input: Record<string, unknown>,
    resume?: string,
    actor: "human" | "agent" = "human",
  ) => {
    const selection = instancesSessionSelection(input);
    const row = await admitInstancesAction(
      {
        id: resume ?? `${key}-${++serial}`,
        kind: "workflow",
        key,
        destination: selection ? { kind: "sdk-session", selection } : { kind: "host" },
        input,
        bases: {},
      },
      crossingOf(actor),
      owner,
      deps,
      resume !== undefined,
    );
    return owner.wait(row.id);
  };
  /** A file a launch can name, written under the test directory. */
  const file = async (name: string, text: string) => {
    const path = join(dir, name);
    await writeFile(path, Buffer.from(text, "utf16le"));
    return path;
  };
  return { calls, owner, deps, admit, dir, peaWork, file, census, machine };
}

/** A held process acquisition, as `instances.start` with owner pea records it. */
async function recordPeaLaunch(owner: ActionJournal, peaWork = "C:/pea-work") {
  const launch = await owner.admit(
    {
      id: "pea-launch",
      kind: "workflow",
      key: "instances.start",
      ...crossingOf("human"),
      destination: { kind: "host" },
      input: { year: "2025", owner: "pea", addins: "on" },
      bases: {},
    },
    async () => ({
      target: null,
      acquisition: planAcquisition(
        "pea-launch",
        peaWork,
        { kind: "create", year: "2025" },
        null,
        false,
      ),
    }),
    (execution) =>
      execution.step("native", "instances.start", { argv: [] }, async () => startedAnswer.result),
  );
  await owner.wait(launch.id);
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
  "D3 %s refuses a granted document plus an uncovered document",
  async (verb) => {
    const f = await setup(() => ({ result: { state: "ok" } }));
    bindControl({ heads: grantHead });
    f.census.documents = [openId, "b".repeat(32)];
    await expect(
      f.admit(
        `instances.${verb}`,
        { session, ...(verb === "restart" ? {} : { unsaved: "keep" }) },
        undefined,
        "agent",
      ),
    ).rejects.toMatchObject({ refusal: { code: "lifecycle.ungranted-documents" } });
    expect(f.calls.every((args) => args[1] === "list")).toBe(true);
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
      basis: { kind: "grant", lifetime: grantedLifetime },
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
    ).rejects.toMatchObject({ refusal: { code: "lifecycle.ungranted-documents" } });
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
    await expect(stop()).rejects.toMatchObject({
      refusal: { code: "lifecycle.ungranted-documents" },
    });
  },
);

test("an agent opens a new copy into the Revit an acquisition started; a reload there stays human", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", document: { openId, path: null } } }),
    [controlledRow({ shape: shape("background") })],
  );
  const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
  // No acquisition holds this Revit yet: it is yours.
  await expect(
    f.admit("instances.open", { source, into: into() }, undefined, "agent"),
  ).rejects.toMatchObject({ refusal: { code: "human.only" } });
  await recordPeaLaunch(f.owner, f.peaWork);
  const copy = await f.admit("instances.open", { source, into: into() }, undefined, "agent");
  expect(copy).toMatchObject({
    basis: { kind: "acquisition", id: "pea-launch", scope: { kind: "process" } },
    result: { acquisition: copy.id, copiedFrom: source },
  });
  await expect(
    f.admit("instances.open", { source: openId, reload: true, into: into() }, undefined, "agent"),
  ).rejects.toMatchObject({ refusal: { code: "human.only" } });
});

test("each Pea acquisition starts its own named Revit, never the person's dev session name", async () => {
  // The person's foreground dev session holds the checkout's default name ("dev" here).
  const f = await setup(() => startedAnswer, [controlledRow()]);
  const starts: string[][] = [];
  const acquisitions: string[] = [];
  for (let n = 0; n < 2; n++) {
    const receipt = await f.admit("instances.start", { year: "2025", owner: "pea", addins: "off" });
    expect(receipt.state).toBe("succeeded");
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
  );
  await recordPeaLaunch(f.owner);
  const source = await f.file("Central.rvt", "Worksharing: Local");
  const before = await readFile(source);
  const receipt = await f.admit("instances.open", { source, into: into("pea-bg") });
  expect(receipt.state).toBe("succeeded");
  const open = f.calls.at(-1)!;
  expect(open[2]!.startsWith(f.peaWork)).toBe(true);
  expect(open).toContain("--detach");
  expect(await readFile(source)).toEqual(before);
  expect((receipt as { result?: unknown }).result).toMatchObject({
    opened: open[2],
    copiedFrom: source,
    detached: true,
  });
});

test("Pea refuses, undispatched, a file whose worksharing it cannot read or a source it cannot resolve", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", document: { openId } } }),
    [controlledRow({ id: "pea-bg", shape: shape("background") })],
  );
  await recordPeaLaunch(f.owner);
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
        ? { source: "C:/Tower.rvt", into: { session: { pid: 4242 } } }
        : {
            session: observed,
            ...(verb === "stop" || verb === "close" ? { unsaved: "keep" } : {}),
            ...(verb === "close"
              ? { document: { source: "sdk", session: { pid: 4242 }, openId } }
              : {}),
          };
    const receipt = await f.admit(`instances.${verb}`, input);
    expect(receipt.state).toBe("succeeded");
    expect(receipt.steps[0]).toMatchObject({ key: `instances.${verb}.adopt`, state: "succeeded" });
    expect(f.calls.map((args) => args.slice(0, 2).join(" "))).toEqual([
      ...(verb === "close" ? ["doc list"] : []),
      "session list",
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
    expect(f.calls.some((args) => args[0] === "doc")).toBe(false);
  },
);

test("F7: an acquisition records its paths before writing; a crash at any boundary reconciles from receipts, never guessed", async () => {
  let opened = "";
  const f = await setup(
    (args) =>
      args[0] === "session"
        ? startedAnswer
        : ((opened = args[2]!),
          { result: { state: "ok", document: { openId, path: args[2], title: "Tower" } } }),
    [],
  );
  const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
  const before = await readFile(source);
  const done = await f.admit("instances.open", { source, into: newRevit({ owner: "pea" }) });
  expect(done.state).toBe("succeeded");
  const intent = foldAcquisitions([done])[0]!.intent;
  // Every path the action created was frozen in its preparation before the first step ran.
  expect(done.steps.map((step) => step.key)).toEqual([
    "acquisition.baseline",
    "acquisition.work",
    "instances.open.start",
    "instances.open",
  ]);
  for (const step of done.steps.filter((each) => each.kind === "file"))
    expect((step.input as { to: string }).to.startsWith(intent.root)).toBe(true);
  expect(opened).toBe((intent.document!.origin as { work: string }).work);
  const certified = [{ openId, isWorkshared: false, isDetached: false }];
  expect(
    acquiredOpenIds(foldAcquisitions([done]), originalProcess, certified, [openId]).get(openId),
  ).toBe(done.id);
  const disk = async () => (await readdir(f.peaWork, { recursive: true })).sort();
  const allocated = await disk();
  // The host died at each boundary: the step was recorded running, its outcome never persisted
  // (also the case "the effect landed, then persistence failed").
  for (let k = 0; k <= done.steps.length; k++) {
    const crashed = {
      ...done,
      state: "running",
      result: undefined,
      steps: [
        ...done.steps.slice(0, k),
        ...(k < done.steps.length
          ? [{ ...done.steps[k]!, state: "running", result: undefined }]
          : []),
      ],
    };
    const path = join(f.dir, `crash-${k}.json`);
    await writeJournal(path, [crashed]);
    const restarted = await new ActionJournal(path).list();
    const [acquisition] = foldAcquisitions(restarted);
    if (k === done.steps.length) {
      // every effect succeeded but completion never persisted: the receipts still bind it
      expect(acquisition).toMatchObject({ state: "held", document: { sdkOpenId: openId } });
      continue;
    }
    expect(restarted[0]!.state).toBe("unknown");
    expect(acquisition).toMatchObject({ state: "reconciling", intent });
    expect(
      acquiredOpenIds(foldAcquisitions(restarted), originalProcess, certified, [openId]).size,
    ).toBe(0);
    // Reconciling read receipts only: nothing was copied, opened or deleted on the way back up.
    expect(await disk()).toEqual(allocated);
  }
  expect(await readFile(source)).toEqual(before);
  expect(f.calls.filter((argv) => argv[1] === "open" || argv[1] === "start")).toHaveLength(2);
  // The lost open is settled from its SDK op receipt by its original request id, never re-sent.
  const lostOpen = join(f.dir, `crash-${done.steps.length - 1}.json`);
  const journal = new ActionJournal(lostOpen);
  const openStep = done.steps.at(-1)!;
  const reads: string[][] = [];
  // The SDK's recorded op response carries the bridge's document itself (acceptance R4d journal).
  const response = { openId, path: opened, title: "Tower" };
  await recoverInstancesAction(done.id, journal, {
    sdk: async (args) => {
      reads.push([...args]);
      return replayAnswer(args, {
        result: {
          state: "ok",
          requestId: openStep.id,
          receipt: {
            requestId: openStep.id,
            key: "doc.open",
            verdict: "ok",
            pid: originalProcess.pid,
            processStartUtc: originalProcess.processStartUtc,
          },
          response: { requestId: openStep.id, key: "doc.open", verdict: "ok", result: response },
        },
      });
    },
  });
  expect(reads).toEqual([["op", "result", openStep.id, "--json"]]);
  const recovered = foldAcquisitions(await journal.list());
  expect(recovered[0]).toMatchObject({ state: "held", document: { sdkOpenId: openId } });
  expect(acquiredOpenIds(recovered, originalProcess, certified, [openId]).get(openId)).toBe(
    done.id,
  );
});

/** An SDK that starts, opens the copy it is given, saves create-only, closes and stops. */
async function acquisitionSetup(detached = false) {
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
        f.census.documents = f.census.documents.filter((id) => id !== flag(args, "--doc"));
        return { result: { state: "ok" } };
      }
      return Error(`unexpected ${args.join(" ")}`);
    },
    [row],
  );
  f.census.facts = { isWorkshared: detached, isDetached: detached };
  const source = await f.file(
    "Tower.rvt",
    detached ? "Worksharing: Enabled" : "Worksharing: Not enabled",
  );
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
  expect(flag(save, "--release")).toBe("none");
  expect(save).not.toContain("--central");
  const plan = JSON.parse(await readFile(intent.diffPlan, "utf8"));
  expect(plan).toMatchObject({
    baseline: { path: (intent.origin as { baseline: string }).baseline },
    domain: { state: "unknown" },
  });
  expect(plan.baseline.sha256).toBe(acquisition.baseline!.sha256);
  // A result is create-only: a second handover refuses before anything dispatches.
  await expect(
    f.admit("instances.handover", { acquisition: acquired.id }, undefined, "agent"),
  ).rejects.toMatchObject({ refusal: { code: "acquisition.unproven" } });
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
    issues: [{ code: "acquisition.changed-after-handover" }],
  });
  const cleaned = await f.admit(
    "instances.cleanup",
    { acquisition: acquired.id, unsaved: "discard" },
    undefined,
    "agent",
  );
  const work = (intent.origin as { work: string }).work;
  expect(cleaned).toMatchObject({
    state: "succeeded",
    basis: { kind: "acquisition", id: acquired.id, scope: { kind: "release" } },
    result: {
      closed: openId,
      removed: [work],
      stopped: { pid: originalProcess.pid, processStartUtc: originalProcess.processStartUtc },
    },
  });
  expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", "stop"]);
  expect(existsSync(work)).toBe(false);
  // The handover's result, its diff plan and the baseline it compares against are kept.
  for (const kept of [
    intent.result,
    intent.diffPlan,
    (intent.origin as { baseline: string }).baseline,
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
  ).rejects.toMatchObject({ refusal: { code: "acquisition.unproven" } });
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
  // A save in place moves nothing: no artifact step.
  const inPlace = await f.admit(
    "instances.save",
    { session, document: sdkDocument, to: { kind: "self" } },
    undefined,
    "agent",
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
    const work = (acquisition.intent.document!.origin as { work: string }).work;
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
      issues: [{ code: "acquisition.changed-after-handover" }],
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
  ).rejects.toMatchObject({ refusal: { code: "acquisition.unproven" } });
  const userB = "b".repeat(32);
  f.census.documents = [openId, userB];
  const kept = await f.admit(
    "instances.cleanup",
    { acquisition: acquired.id, unsaved: "discard" },
    undefined,
    "agent",
  );
  const origin = acquisition.intent.document!.origin as { work: string; baseline: string };
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
  expect(stopped).toMatchObject({ state: "succeeded", result: { closed: null, removed: [] } });
  expect(f.calls.filter((argv) => argv[1] === "close")).toHaveLength(1);
  expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", "stop"]);
});

/** The SDK's `op result` for an op whose recorded process died before it settled (op.process-dead). */
const abandonedOp = (requestId: string, key: string, process: { pid: number }): Answer => ({
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
      | { case: string; process: typeof originalProcess; receipt: { receiptPath: string } }
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
const stepStates = (receipt: { steps: readonly { key: string; state: string }[] }) =>
  receipt.steps.map((step) => `${step.key}:${step.state}`);

test("W2 20 (a): a start whose pe-revit died with no session is not done; resume starts afresh", async () => {
  const { f, world, input } = await crashWorld();
  world.crash = "start";
  const lost = await f.admit("instances.open", input);
  expect(lost.state).toBe("unknown");
  const start = lost.steps.at(-1)!;
  world.ops[start.id] = abandonedOp(start.id, "session.start", { pid: 37744 });
  const recovered = await recoverInstancesAction(lost.id, f.owner, f.deps);
  expect(stepStates(recovered)).toEqual([
    "acquisition.baseline:succeeded",
    "acquisition.work:succeeded",
    "instances.open.start:failed",
  ]);
  // It ran: a dead start is not done, never "nothing was dispatched".
  expect(recovered.steps.at(-1)).not.toHaveProperty("notDispatched");
  const resumed = await f.admit("instances.open", input, lost.id);
  expect(resumed.state, JSON.stringify(resumed)).toBe("succeeded");
  expect(world.starts).toHaveLength(2);
  expect(flag(world.starts[1]!, "--expect-session")).toBe("absent");
  expect(flag(world.starts[1]!, "--request-id")).not.toBe(start.id);
  expect(foldAcquisitions(await f.owner.list())[0]).toMatchObject({
    state: "held",
    process: { pid: 101 },
    document: { sdkOpenId: openId },
  });
});

test("W2 20 (a'): a start whose pe-revit died after its Revit came up is done from the session list", async () => {
  const { f, world, rows, input } = await crashWorld();
  world.crash = "start";
  const lost = await f.admit("instances.open", input);
  const start = lost.steps.at(-1)!;
  world.ops[start.id] = abandonedOp(start.id, "session.start", { pid: 37744 });
  const id = acquisitionSessionId(lost.id);
  const process = { ...originalProcess, pid: 77 };
  rows.push(
    controlledRow({
      id,
      process,
      receipt: { receiptPath: "C:/r/77.json" },
      shape: shape("background"),
    }),
  );
  const recovered = await recoverInstancesAction(lost.id, f.owner, f.deps);
  expect(recovered.steps.at(-1)).toMatchObject({
    state: "succeeded",
    result: { id, session: { process: { pid: 77 } } },
  });
  const resumed = await f.admit("instances.open", input, lost.id);
  expect(resumed.state, JSON.stringify(resumed)).toBe("succeeded");
  expect(world.starts).toHaveLength(1);
  expect(flag(world.opens[0]!, "--expect-session")).toBe("C:/r/77.json");
});

test("W2 20 (b): resume redoes a start whose Revit died, never reusing it", async () => {
  const { f, world, row, die, input } = await crashWorld();
  world.crash = "open";
  const lost = await f.admit("instances.open", input);
  expect(lost.state).toBe("unknown");
  const first = row(acquisitionSessionId(lost.id))!;
  die();
  // The open's pe-revit died before the SDK admitted it: recovery proves it never ran.
  const recovered = await recoverInstancesAction(lost.id, f.owner, f.deps);
  expect(recovered.steps.at(-1)).toMatchObject({ state: "failed", notDispatched: true });
  const resumed = await f.admit("instances.open", input, lost.id);
  expect(resumed.state, JSON.stringify(resumed)).toBe("succeeded");
  expect(stepStates(resumed)).toEqual([
    "acquisition.baseline:succeeded",
    "acquisition.work:succeeded",
    "instances.open.start:failed",
    "instances.open:failed",
    "instances.open.start:succeeded",
    "instances.open:succeeded",
  ]);
  // The dead start keeps what it once returned; the redo replaces exactly its gone row.
  expect(resumed.steps[2]).toMatchObject({
    error: expect.stringContaining("gone"),
    evidence: { result: { session: { process: { pid: first.process.pid } } } },
  });
  expect(flag(world.starts[1]!, "--expect-session")).toBe(first.receipt.receiptPath);
  expect(world.opens).toHaveLength(2);
  expect(foldAcquisitions(await f.owner.list())[0]).toMatchObject({
    state: "held",
    process: { pid: first.process.pid + 1 },
  });
});

test("W2 20 (c): an open whose Revit died is not done, and cleanup releases what is left", async () => {
  const { f, world, row, die, input } = await crashWorld();
  world.crash = "open";
  const lost = await f.admit("instances.open", input);
  const open = lost.steps.at(-1)!;
  const revit = row(acquisitionSessionId(lost.id))!.process;
  die();
  world.ops[open.id] = abandonedOp(open.id, "doc.open", revit);
  const recovered = await recoverInstancesAction(lost.id, f.owner, f.deps);
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
  const origin = acquisition!.intent.document!.origin as { work: string; baseline: string };
  expect(cleaned, JSON.stringify(cleaned)).toMatchObject({
    state: "succeeded",
    result: { closed: null, removed: [origin.work, origin.baseline], stopped: null },
  });
  // Nothing to close or stop: the dead Revit took its lifetime with it.
  expect(f.calls.slice(before).filter((argv) => argv[1] !== "list")).toEqual([]);
  expect(foldAcquisitions(await f.owner.list())[0]!.state).toBe("released");
});

/**
 * Acceptance R4d (beta.207): our host died during the open, Pea's Revit SURVIVED with the work copy
 * open, recovery read the SDK's answer and resume completed. Cleanup then ran only
 * `acquisition.remove` and failed EBUSY on the open work copy: it must close and stop what the SDK
 * still reports alive. The recovered op response is `{requestId,key,verdict,result:<document>}`.
 */
test("R4d: after recovery over HTTP, cleanup closes and stops the Revit that survived our host", async () => {
  const { f, world, row, input } = await crashWorld();
  world.crash = "open";
  const server = await serveRoutes(
    makeCallRoute(f.owner, undefined, f.deps),
    {} as RevitBridge["Service"],
  );
  cleanup.push(() => server.close());
  const human = { [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }) };
  const post = async (path: string, body: unknown) => {
    const response = await fetch(`${server.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...human },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    expect(response.status, text).toBeLessThan(300);
    return JSON.parse(text) as {
      id: string;
      state: string;
      steps: { key: string; state: string }[];
    };
  };
  const admitted = await post("/actions", {
    id: "r4d-open",
    kind: "workflow",
    key: "instances.open",
    destination: { kind: "host" },
    input,
    bases: {},
  });
  const lost = await f.owner.wait(admitted.id);
  expect(lost.state).toBe("unknown");
  const open = lost.steps.at(-1)!;
  const revit = row(acquisitionSessionId(lost.id))!;
  f.census.process = revit.process;
  const work = world.opens[0]![2]!;
  world.ops[open.id] = {
    result: {
      state: "ok",
      requestId: open.id,
      receipt: { requestId: open.id, key: "doc.open", verdict: "ok" },
      response: {
        requestId: open.id,
        key: "doc.open",
        verdict: "ok",
        result: { openId, title: "Tower", path: work, isModified: false },
      },
    },
  };
  expect(stepStates(await post("/actions/recover", { id: lost.id })).at(-1)).toBe(
    "instances.open:succeeded",
  );
  await post("/actions/resume", { id: lost.id });
  expect((await f.owner.wait(lost.id)).state).toBe("succeeded");
  expect(foldAcquisitions(await f.owner.list())[0]).toMatchObject({
    state: "held",
    document: { sdkOpenId: openId },
  });
  const cleaning = await post("/actions", {
    id: "r4d-cleanup",
    kind: "workflow",
    key: "instances.cleanup",
    destination: { kind: "host" },
    input: { acquisition: lost.id, unsaved: "discard" },
    bases: {},
  });
  const cleaned = await f.owner.wait(cleaning.id);
  expect(cleaned.state, JSON.stringify(cleaned)).toBe("succeeded");
  expect(cleaned.steps.map((step) => step.key)).toEqual([
    "instances.cleanup.close",
    "acquisition.remove",
    "acquisition.remove",
    "instances.cleanup.stop",
  ]);
  expect(cleaned).toMatchObject({
    result: { closed: openId, stopped: { pid: revit.process.pid } },
  });
  expect(row(acquisitionSessionId(lost.id))!.case).toBe("gone-receipt");
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
    const settled = await recoverInstancesAction(lost.id, f.owner, f.deps);
    expect(settled.steps[0]!.state).toBe("unknown");
    expect(f.calls.at(-1)).toEqual(["op", "result", lost.steps[0]!.id, "--json"]);
    expect(f.calls.filter((args) => args[1] === "start")).toHaveLength(1);
  },
);

test("restart, stop and close run for a human; stop and close require an unsaved choice", async () => {
  const f = await setup((args) =>
    args[0] === "session"
      ? { result: { id: "dev", state: "ok", phase: "ready" } }
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
  const admit = f.owner.admit.bind(f.owner);
  f.owner.admit = (...args) => {
    f.census.documents = [openId];
    return admit(...args);
  };
  expect(
    await f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent"),
  ).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringContaining("lifecycle.ungranted-documents"),
  });
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
});

test("a user document opened in Pea's Revit after admission refuses Pea's stop at effect entry", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }), [controlledRow()]);
  await recordPeaLaunch(f.owner);
  f.census.documents = [];
  const admit = f.owner.admit.bind(f.owner);
  f.owner.admit = (...args) => {
    f.census.documents = [openId];
    return admit(...args);
  };
  expect(
    await f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent"),
  ).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringContaining("lifecycle.ungranted-documents"),
  });
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
});

const sdkDocument = { source: "sdk", session: session.selection, openId } as const;

test("an agent save is one document crossing: the granted lifetime admits, another refuses", async () => {
  const f = await setup(() => ({ result: { state: "ok", document: { openId } } }));
  bindControl({ heads: grantHead });
  f.census.documents = [openId, "b".repeat(32)];
  const input = { session, document: sdkDocument, to: { kind: "self" } };
  expect(await f.admit("instances.save", input, undefined, "agent")).toMatchObject({
    state: "succeeded",
    basis: { kind: "grant", lifetime: grantedLifetime },
  });
  await expect(
    f.admit(
      "instances.save",
      { ...input, document: { ...sdkDocument, openId: "b".repeat(32) } },
      undefined,
      "agent",
    ),
  ).rejects.toMatchObject({ refusal: { code: "grant.required" } });
});

test("/actions/cancel stops a running Instances step through the SDK op cancel, never the Revit bridge", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const f = await setup(async (args) => {
    if (args[0] === "op") return { result: { state: "ok" } };
    await held;
    return { result: { state: "cancelled" } };
  });
  const row = await admitInstancesAction(
    {
      id: "save-held",
      kind: "workflow",
      key: "instances.save",
      destination: { kind: "sdk-session", selection: session.selection },
      input: { session, document: sdkDocument, to: { kind: "self" } },
      bases: {},
    },
    crossingOf("human"),
    f.owner,
    f.deps,
  );
  while (!f.calls.some((args) => args[1] === "save")) await new Promise((r) => setTimeout(r, 5));
  const step = (await f.owner.list(undefined, row.id))[0]!.steps.at(-1)!;
  const server = await serveRoutes(
    makeCallRoute(f.owner, undefined, { sdk: f.deps.sdk }),
    {} as RevitBridge["Service"],
  );
  cleanup.push(() => server.close());
  const response = await fetch(`${server.base}/actions/cancel`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HOST_CONTEXT_HEADER]: mintContext({ kind: "human", via: "cli" }),
    },
    body: JSON.stringify({ id: row.id }),
  });
  expect(response.status).toBe(202);
  expect(f.calls.at(-1)).toEqual(["op", "cancel", step.id, "--json"]);
  release();
  expect((await f.owner.wait(row.id)).state).toBe("cancelled");
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
    const f = await setup(() => ({ result: { id: "dev", state: "ok", phase: "stopped" } }));
    const server = await serveRoutes(
      makeCallRoute(f.owner, undefined, { sdk: f.deps.sdk }),
      {} as RevitBridge["Service"],
    );
    cleanup.push(() => server.close());
    // The owner's terminal: its context rides every host call the client makes.
    const prior = process.env[HOST_CONTEXT_VARIABLE];
    process.env[HOST_CONTEXT_VARIABLE] = mintContext({ kind: "human", via: "cli" });
    const row = await runSemanticAction(
      key,
      { session, unsaved: "keep" },
      undefined,
      {},
      server.base,
    ).finally(() => {
      if (prior === undefined) delete process.env[HOST_CONTEXT_VARIABLE];
      else process.env[HOST_CONTEXT_VARIABLE] = prior;
    });
    expect(row).toMatchObject({ state: "succeeded", key });
    expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", verb]);
  },
);
