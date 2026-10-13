import { afterEach, expect, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { instancesActions, instancesSessionSelection } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { HOST_CONTEXT_HEADER, HOST_CONTEXT_VARIABLE } from "@pe/host-contracts/contracts";
import { admitInstancesAction, recoverInstancesAction } from "../src/instances-actions.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { RevitBridge } from "../src/bridge.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";
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
      return sdkEnvelope({
        sessions: sessionRows,
      });
    if (args[0] === "doc" && args[1] === "list") {
      const process = args.includes("--pid") ? observed.process : originalProcess;
      return JSON.stringify({
        ...JSON.parse(
          sdkEnvelope({
            state: "ok",
            documents: census.documents.map((id) => ({ openId: id, isModified: census.modified })),
          }),
        ),
        resolved: { ...process, id: "dev" },
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
    return JSON.stringify({
      ...JSON.parse(sdkEnvelope(reply.result)),
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
    grants: { grants: () => [], subscribe: () => () => {} },
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

function grantHead(): ThreadHead {
  const lifetime = { session: "bridge-dev", openId };
  return {
    defaultTarget: { kind: "open", ref: lifetime },
    revision: 1,
    lastHumanMessageAt: null,
    grant: {
      lifetime,
      grantedVia: "local",
      revoked: null,
      grantedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
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
      basis: { kind: "grant", lifetime: grantHead().grant!.lifetime },
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

test("a user's own background run stays you and refuses agent stop without a grant", async () => {
  const f = await setup(
    () => ({ result: { state: "ok" } }),
    [controlledRow({ shape: shape("background") })],
  );
  await expect(
    f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent"),
  ).rejects.toMatchObject({ refusal: { code: "lifecycle.ungranted-documents" } });
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
});

test.each(["start", "open"])(
  "a held Pea %s acquisition admits agent stop only when every document is its own",
  async (verb) => {
    const f = await setup(
      (args) =>
        args[1] === "start"
          ? startedAnswer
          : { result: { state: "ok", document: { openId, path: null } } },
      [controlledRow({ shape: shape("background") })],
    );
    const launch = await f.admit(
      `instances.${verb}`,
      verb === "start"
        ? { year: "2025", owner: "pea", addins: "on" }
        : { source: "cld://US/{p}p/{m}Tower.rvt", into: newRevit({ owner: "pea" }) },
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

test("the launch schema carries every open option and no staged state", () => {
  const launch = instancesActions["instances.open"].input;
  expect(
    launch.parse({
      source: "C:/Tower.rvt",
      template: false,
      into: into(),
      detach: true,
      upgrade: true,
      links: "allow",
      reload: false,
    }),
  ).toMatchObject({ detach: true, upgrade: true, links: "allow" });
  // Exactly one destination: a session, or a new Revit.
  expect(
    launch.safeParse({ source: "C:/Tower.rvt", into: { ...into(), ...newRevit() } }).success,
  ).toBe(false);
  expect(launch.safeParse({ source: "C:/Tower.rvt" }).success).toBe(false);
  // A launch cannot carry a session name, a posture, or a workspace: those were the staged shape.
  expect(
    launch.safeParse({ source: "C:/Tower.rvt", into: into(), workspaceId: "instances" }).success,
  ).toBe(false);
  expect(
    launch.safeParse({ source: "C:/Tower.rvt", into: newRevit({ owner: "somebody" }) }).success,
  ).toBe(false);
  expect(instancesActions["instances.start"].input.safeParse({ year: "2025" }).success).toBe(false);
  for (const key of [
    "instances.start",
    "instances.open",
    "instances.restart",
    "instances.stop",
    "instances.close",
  ] as const)
    expect(instancesActions[key].actor).toBe("any");
});

test.each([
  [{ owner: "you", addins: "on" }, false, false],
  [{ owner: "pea", addins: "off" }, true, true],
])("start %j reaches session start as background %s, quarantine %s", async (shapeOf, bg, q) => {
  const f = await setup(() => startedAnswer, []);
  const receipt = await f.admit("instances.start", { year: "2025", ...shapeOf });
  expect(receipt.state).toBe("succeeded");
  const argv = f.calls.at(-1)!;
  expect(argv.slice(0, 2)).toEqual(["session", "start"]);
  expect(flag(argv, "--year")).toBe("2025");
  expect(flag(argv, "--request-id")).toBe(receipt.steps[0]!.id);
  expect(flag(argv, "--expect-session")).toBe("absent");
  expect(argv.includes("--background")).toBe(bg);
  expect(argv.includes("--quarantine")).toBe(q);
  if (!bg) expect(argv).not.toContain("--id");
  expect(f.calls.map((call) => call.slice(0, 2).join(" "))).toEqual(["session start"]);
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

test("every option reaches doc open for a running session, and the receipt names the opened path", async () => {
  const f = await setup(() => ({ result: { state: "ok", openId } }));
  const receipt = await f.admit("instances.open", {
    source: "C:/Tower.rvt",
    into: into(),
    detach: true,
    upgrade: true,
    links: "allow",
  });
  expect(receipt.state).toBe("succeeded");
  expect(f.calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["session list", "doc open"]);
  expect(f.calls[0]).toEqual(["session", "list", "--id", "dev", "--json"]);
  const open = f.calls.at(-1)!;
  expect(open.slice(0, 3)).toEqual(["doc", "open", "C:/Tower.rvt"]);
  expect(flag(open, "--id")).toBe("dev");
  expect(open).toContain("--detach");
  expect(open).toContain("--upgrade");
  expect(flag(open, "--links")).toBe("allow");
  expect(open).not.toContain("--unsynced");
  expect(flag(open, "--request-id")).toBe(receipt.steps[0]!.id);
  expect(flag(open, "--expect-session")).toBe(receiptPath);
  expect(flag(open, "--expect-doc")).toBe("absent");
  expect(open).not.toContain("--reload");
  expect(receipt.steps[0]).toMatchObject({ state: "succeeded", key: "instances.open" });
  expect((receipt as { result?: unknown }).result).toMatchObject({
    opened: "C:/Tower.rvt",
    copiedFrom: null,
    detached: true,
    document: { openId },
  });
});

test("an open that names no option sends none of them", async () => {
  const f = await setup(() => ({ result: { state: "ok", openId } }));
  expect((await f.admit("instances.open", { source: "C:/Tower.rvt", into: into() })).state).toBe(
    "succeeded",
  );
  const open = f.calls.at(-1)!;
  for (const name of ["--detach", "--upgrade", "--reload", "--template", "--unsynced"])
    expect(open).not.toContain(name);
  expect(open).not.toContain("--links");
});

test("reload names the open document and a template creates a new one", async () => {
  const f = await setup(() => ({ result: { state: "ok", openId } }));
  await f.admit("instances.open", { source: openId, into: into(), reload: true });
  const reload = f.calls.at(-1)!;
  expect(reload.slice(0, 3)).toEqual(["doc", "open", openId]);
  expect(reload).toContain("--reload");
  expect(flag(reload, "--expect-doc")).toBe(openId);

  await f.admit("instances.open", { source: "C:/Office.rte", into: into(), template: true });
  const template = f.calls.at(-1)!;
  expect(template.slice(0, 2)).toEqual(["doc", "open"]);
  expect(flag(template, "--template")).toBe("C:/Office.rte");
  expect(template[2]).toBe("--id");
  expect(flag(template, "--expect-doc")).toBe("new");
});

test("a launch into a new Revit starts it, then opens the source as its own op in that session", async () => {
  const f = await setup(
    (args) => (args[0] === "session" ? startedAnswer : { result: { state: "ok", openId } }),
    [],
  );
  const receipt = await f.admit("instances.open", {
    source: "C:/Tower.rvt",
    into: newRevit({ addins: "off" }),
    upgrade: true,
    links: "allow",
  });
  expect(receipt.state).toBe("succeeded");
  const [start, open] = receipt.steps;
  expect(start).toMatchObject({ key: "instances.open.start", state: "succeeded" });
  expect(open).toMatchObject({ key: "instances.open", state: "succeeded" });
  const [startArgv, openArgv] = f.calls.filter((argv) => argv[1] !== "list");
  expect(startArgv!.slice(0, 2)).toEqual(["session", "start"]);
  expect(startArgv).not.toContain("--background");
  expect(startArgv).toContain("--quarantine");
  expect(startArgv).not.toContain("C:/Tower.rvt");
  expect(flag(startArgv!, "--request-id")).toBe(start!.id);
  expect(openArgv!.slice(0, 3)).toEqual(["doc", "open", "C:/Tower.rvt"]);
  expect(flag(openArgv!, "--id")).toBe("dev");
  expect(openArgv).toContain("--upgrade");
  expect(flag(openArgv!, "--links")).toBe("allow");
  expect(flag(openArgv!, "--request-id")).toBe(open!.id);
  expect(flag(openArgv!, "--expect-session")).toBe(receiptPath);
  expect(flag(openArgv!, "--expect-doc")).toBe("absent");
});

test("a Pea launch copies a local, non-workshared file into Pea's work folder and opens the copy", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", openId } }),
    [controlledRow({ id: "pea-bg", shape: shape("background") })],
  );
  await recordPeaLaunch(f.owner);
  const source = await f.file("Tower.rvt", "header Worksharing: Not enabled tail");
  const before = await readFile(source);
  const receipt = await f.admit("instances.open", { source, into: into("pea-bg") });
  expect(receipt.state).toBe("succeeded");
  const open = f.calls.at(-1)!;
  const opened = open[2]!;
  expect(opened).not.toBe(source);
  expect(opened.startsWith(f.peaWork)).toBe(true);
  expect(opened.endsWith("Tower.rvt")).toBe(true);
  expect(open).not.toContain("--detach");
  expect(await readFile(opened)).toEqual(before);
  expect(await readFile(source)).toEqual(before);
  // No half-written copy is left beside the finished one.
  expect(await readdir(join(opened, ".."))).toEqual(["Tower.rvt"]);
  expect((receipt as { result?: unknown }).result).toMatchObject({
    opened,
    copiedFrom: source,
    detached: false,
  });
});

test("a Pea launch into a new Revit copies the file before the Revit starts", async () => {
  const f = await setup(
    (args) => (args[0] === "session" ? startedAnswer : { result: { state: "ok", openId } }),
    [],
  );
  const source = await f.file("Plant.rvt", "Worksharing: Not enabled");
  const receipt = await f.admit("instances.open", { source, into: newRevit({ owner: "pea" }) });
  expect(receipt.state).toBe("succeeded");
  const open = f.calls.at(-1)!;
  expect(open[2]!.startsWith(f.peaWork)).toBe(true);
  expect(f.calls.filter((argv) => argv[1] === "start")[0]).toContain("--background");
});

test("a Pea launch of a workshared model copies first, then opens the copy detached", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", openId } }),
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

test("a Pea launch of a cloud model opens detached", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", openId } }),
    [controlledRow({ id: "pea-bg", shape: shape("background") })],
  );
  await recordPeaLaunch(f.owner);
  const source = "cld://US/{p}p/{m}Tower.rvt";
  expect((await f.admit("instances.open", { source, into: into("pea-bg") })).state).toBe(
    "succeeded",
  );
  const open = f.calls.at(-1)!;
  expect(open[2]).toBe(source);
  expect(open).toContain("--detach");
  // A cloud open has no default for unsaved local work; the launch keeps it.
  expect(flag(open, "--unsynced")).toBe("keep");
});

test("Pea refuses, undispatched, a file whose worksharing it cannot read or a source it cannot resolve", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", openId } }),
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

test("a person's foreground session opens the file as given, with no copy", async () => {
  const f = await setup(() => ({ result: { state: "ok", openId } }));
  const source = await f.file("Mine.rvt", "Worksharing: Not enabled");
  expect(
    (await f.admit("instances.open", { source, into: into() }, undefined, "human")).state,
  ).toBe("succeeded");
  expect(f.calls.at(-1)![2]).toBe(source);
  expect(f.calls.at(-1)).not.toContain("--detach");
  expect(existsSync(f.peaWork)).toBe(false);
});

test("allowing missing links reaches doc open and its omission result stays in the receipt", async () => {
  const nativeResult = {
    state: "ok",
    openId,
    missingLinkPolicy: "allow",
    missingLinkCount: 1,
    missingLinks: [
      {
        elementId: "1234",
        name: "Site",
        type: "RevitLinkType",
        status: "NotFound",
        path: "C:/Links/site.rvt",
      },
    ],
  };
  const f = await setup(() => ({ result: nativeResult }));
  const receipt = await f.admit("instances.open", {
    source: "C:/Tower.rvt",
    into: into(),
    links: "allow",
  });
  expect(receipt.state).toBe("succeeded");
  expect(receipt.steps[0]).toMatchObject({ state: "succeeded", result: nativeResult });
  expect(flag(f.calls.at(-1)!, "--links")).toBe("allow");
});

test("the default missing-links refusal keeps its SDK explanation", async () => {
  const f = await setup(() => ({
    result: { state: "refused" },
    diagnostics: [
      {
        code: "doc.missing-links",
        detail: "C:/Links/site.rvt was not found",
        fix: null,
      },
    ],
  }));
  const receipt = await f.admit("instances.open", { source: "C:/Tower.rvt", into: into() });
  expect(receipt.state).toBe("failed");
  expect(receipt.steps[0]).toMatchObject({
    state: "failed",
    status: 409,
    evidence: {
      result: {
        diagnostics: [{ code: "doc.missing-links", detail: "C:/Links/site.rvt was not found" }],
      },
    },
  });
});

test("only a matching running open blocks a new intent; unknown remains recoverable without blocking later opens", async () => {
  let entered!: () => void;
  const dispatched = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  const f = await setup(async () => {
    if (first) {
      first = false;
      entered();
      await held;
      return Error("lost original response");
    }
    return { result: { state: "ok" } };
  });
  const open = (source: string) => f.admit("instances.open", { source, into: into() });
  const original = open("C:/Tower.rvt");
  await dispatched;
  try {
    expect(await open("C:/Tower.rvt")).toMatchObject({
      state: "failed",
      notDispatched: true,
      error: expect.stringContaining("already opening"),
    });
    expect((await open("C:/Other.rvt")).state).toBe("succeeded");
  } finally {
    release();
  }
  const lost = await original;
  expect(lost.state).toBe("unknown");
  expect((await open("C:/Tower.rvt")).state).toBe("succeeded");
  expect((await f.owner.list(undefined, lost.id))[0]?.state).toBe("unknown");
  expect(f.calls.filter((args) => args[0] === "doc")).toHaveLength(3);
});

test("a restart binds the exact recorded incarnation; a foreign incarnation is refused undispatched", async () => {
  const f = await setup(() => ({ result: { state: "ok", id: "dev" } }));
  const receipt = await f.admit("instances.restart", { session });
  expect(receipt.state).toBe("succeeded");
  expect(f.calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["session list", "session hr"]);
  expect(f.calls[0]).toEqual(["session", "list", "--id", "dev", "--json"]);
  expect(flag(f.calls.at(-1)!, "--expect-session")).toBe(receiptPath);

  const foreign = await f.admit("instances.restart", {
    session: { selection: { id: "dev" }, process: { ...originalProcess, pid: 43 } },
  });
  expect(foreign).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.calls.at(-1)?.slice(0, 2)).toEqual(["session", "list"]);
});

test.each([2, 3])(
  "an empty-result SDK exit %s is a settled undispatched refusal",
  async (exitCode) => {
    const f = await setup(() => ({
      result: {},
      exitCode,
      diagnostics: [{ code: "session.bad-invocation", detail: "invalid selector", fix: null }],
    }));
    expect(
      await f.admit("instances.start", { year: "2025", owner: "you", addins: "on" }),
    ).toMatchObject({
      state: "failed",
      notDispatched: true,
      error: expect.stringContaining("invalid selector"),
    });
  },
);

test.each(["open", "stop", "restart", "close"])(
  "observed 4242 is adopted by the SDK before %s dispatches by pid with its receipt",
  async (verb) => {
    const f = await setup(
      (args) => (args[1] === "start" ? adoptionAnswer : { result: { state: "ok", openId } }),
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

test("a numeric controlled session name stays an id", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }), [controlledRow({ id: "4242" })]);
  expect(
    (await f.admit("instances.open", { source: "C:/Tower.rvt", into: { session: { id: "4242" } } }))
      .state,
  ).toBe("succeeded");
  expect(flag(f.calls.at(-1)!, "--id")).toBe("4242");
  expect(f.calls.at(-1)).not.toContain("--pid");
  expect(f.calls.some((args) => args[1] === "start")).toBe(false);
});

test("a selection that names no running session is refused before anything dispatches", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }), []);
  expect(
    await f.admit("instances.open", { source: "C:/Tower.rvt", into: { session: { id: "gone" } } }),
  ).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.calls.map((args) => args.slice(0, 2).join(" "))).toEqual(["session list"]);
});

test.each(["pid", "processStartUtc"] as const)(
  "an observed original %s mismatch refuses before adoption",
  async (field) => {
    const f = await setup(() => adoptionAnswer, [observedRow]);
    const foreign = {
      ...observed,
      process: {
        ...observed.process,
        [field]: field === "pid" ? 4243 : "1970-01-01T00:00:02.0000000Z",
      },
    };
    expect(await f.admit("instances.restart", { session: foreign })).toMatchObject({
      state: "failed",
      notDispatched: true,
    });
    expect(f.calls).toHaveLength(1);
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

test("a supervisor refusal after an effect leg never claims nothing was dispatched", async () => {
  const response = JSON.parse(
    sdkEnvelope({ state: "refused", legs: [{ name: "stop", status: "ok" }] }),
  );
  response.diagnostics = [
    { code: "op.stale-expectation", detail: "replacement refused after stop", fix: null },
  ];
  const f = await setup((args) =>
    args[0] === "op"
      ? {
          result: {
            state: "refused",
            requestId: args[2],
            receipt: { requestId: args[2], key: "session.hr", verdict: "refused" },
            response,
          },
        }
      : Error("lost"),
  );
  const lost = await f.admit("instances.restart", { session });
  const settled = await recoverInstancesAction(lost.id, f.owner, f.deps);
  expect(settled.steps[0]).toMatchObject({ state: "failed" });
  expect(settled.steps[0]).not.toHaveProperty("notDispatched", true);
  expect(settled).not.toHaveProperty("notDispatched", true);
  expect(f.calls.filter((args) => args[1] === "hr")).toHaveLength(1);
});

test.each(["adoption", "mutation"])(
  "a lost observed %s recovers and resumes without repeating SDK adoption",
  async (lostLeg) => {
    let lostOnce = false;
    const f = await setup(
      (args) => {
        if (args[0] === "op") {
          const adoption = lostLeg === "adoption";
          return {
            result: {
              state: "ok",
              requestId: args[2],
              receipt: {
                requestId: args[2],
                key: adoption ? "session.start" : "doc.open",
                verdict: "ok",
              },
              response: adoption
                ? { ...JSON.parse(sdkEnvelope(adopted)), resolved: adoptionAnswer.resolved }
                : { state: "ok", openId },
            },
          };
        }
        if (!lostOnce && (lostLeg === "adoption" ? args[1] === "start" : args[0] === "doc")) {
          lostOnce = true;
          return Error("lost original response");
        }
        return args[1] === "start" ? adoptionAnswer : { result: { state: "ok", openId } };
      },
      [observedRow],
    );
    const input = { source: "C:/Tower.rvt", into: { session: { pid: 4242 } } };
    const lost = await f.admit("instances.open", input);
    expect(lost.state).toBe("unknown");
    await recoverInstancesAction(lost.id, f.owner, f.deps);
    const resumed = await f.admit("instances.open", input, lost.id);
    expect(resumed.state).toBe("succeeded");
    expect(f.calls.filter((args) => args[1] === "start")).toHaveLength(1);
    expect(f.calls.filter((args) => args[0] === "doc")).toHaveLength(1);
  },
);

test("a Pea copy is made once: resuming a lost open reuses the frozen copy", async () => {
  let lostOnce = true;
  const f = await setup(
    (args) => {
      if (args[0] === "op")
        return {
          result: {
            state: "ok",
            requestId: args[2],
            receipt: { requestId: args[2], key: "doc.open", verdict: "ok" },
            response: { requestId: args[2], key: "doc.open", verdict: "ok", result: { openId } },
          },
        };
      if (lostOnce) {
        lostOnce = false;
        return Error("lost original response");
      }
      return { result: { state: "ok", openId } };
    },
    [controlledRow({ id: "pea-bg", shape: shape("background") })],
  );
  await recordPeaLaunch(f.owner);
  const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
  const input = { source, into: into("pea-bg") };
  const lost = await f.admit("instances.open", input);
  expect(lost.state).toBe("unknown");
  await recoverInstancesAction(lost.id, f.owner, f.deps);
  const resumed = await f.admit("instances.open", input, lost.id);
  expect(resumed.state).toBe("succeeded");
  expect(await readdir(f.peaWork)).toHaveLength(1);
  expect((resumed as { result?: { opened?: string } }).result?.opened?.startsWith(f.peaWork)).toBe(
    true,
  );
});

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
  const response = { state: "ok", document: { openId, path: opened } };
  await recoverInstancesAction(done.id, journal, {
    sdk: async (args) => {
      reads.push([...args]);
      return sdkEnvelope({
        state: "ok",
        requestId: openStep.id,
        receipt: { requestId: openStep.id, key: "doc.open", verdict: "ok" },
        response: { requestId: openStep.id, key: "doc.open", verdict: "ok", result: response },
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
        await mkdir(dirname(flag(args, "--out")!), { recursive: true });
        await writeFile(flag(args, "--out")!, "saved result", { flag: "wx" });
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

test("a detached handover preserves worksets", async () => {
  const { f, acquired } = await acquisitionSetup(true);
  expect(
    await f.admit("instances.handover", { acquisition: acquired.id }, undefined, "agent"),
  ).toMatchObject({ state: "succeeded" });
  const save = f.calls.find((argv) => argv[1] === "save")!;
  expect(flag(save, "--worksets")).toBe("preserve");
  expect(save).not.toContain("strip");
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

test("a reconciling acquisition refuses handover and cleanup until recovered; its lost open is never replayed", async () => {
  const f = await setup(
    (args) => (args[0] === "session" ? startedAnswer : Error("lost open response")),
    [controlledRow({ shape: shape("background") })],
  );
  const source = await f.file("Tower.rvt", "Worksharing: Not enabled");
  const lost = await f.admit("instances.open", { source, into: newRevit({ owner: "pea" }) });
  expect(lost.state).toBe("unknown");
  const before = f.calls.length;
  for (const [key, input] of [
    ["instances.handover", { acquisition: lost.id }],
    ["instances.cleanup", { acquisition: lost.id, unsaved: "discard" }],
  ] as const)
    await expect(f.admit(key, input, undefined, "agent")).rejects.toMatchObject({
      refusal: { code: "acquisition.unproven" },
    });
  expect(f.calls.slice(before)).toEqual([]);
  expect(f.calls.filter((argv) => argv[1] === "open")).toHaveLength(1);
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

test("an unknown supervisor request is refused undispatched from the read-only receipt lookup", async () => {
  const f = await setup(
    (args) =>
      args[0] === "op"
        ? {
            result: { requestId: args[2], state: "refused" },
            diagnostics: [{ code: "op.unknown-request", detail: "never admitted", fix: null }],
          }
        : Error("lost"),
    [],
  );
  const lost = await f.admit("instances.start", { year: "2025", owner: "you", addins: "on" });
  const settled = await recoverInstancesAction(lost.id, f.owner, f.deps);
  expect(settled.steps[0]).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.calls.filter((args) => args[1] === "start")).toHaveLength(1);
});

test("a pre-admission SDK refusal is failed and undispatched; recovery settles a lost open from its op receipt", async () => {
  let mode: "refuse" | "hang" | "answer" = "refuse";
  const f = await setup((args) => {
    if (args[0] === "op")
      return {
        result: {
          state: "ok",
          requestId: args[2],
          receipt: { requestId: args[2], key: "doc.open", verdict: "ok" },
          response: { requestId: args[2], key: "doc.open", verdict: "ok", result: { openId } },
        },
      };
    if (mode === "refuse")
      return {
        result: { state: "refused" },
        diagnostics: [
          { code: "op.stale-expectation", detail: "the session is a replacement", fix: null },
        ],
      };
    if (mode === "hang") return Error("pe-revit produced no output");
    return { result: { state: "ok", openId } };
  });
  const input = { source: "C:/Tower.rvt", into: into() };
  const refused = await f.admit("instances.open", input);
  expect(refused).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringContaining("op.stale-expectation"),
  });

  mode = "hang";
  const lost = await f.admit("instances.open", input);
  expect(lost.state).toBe("unknown");
  mode = "answer";
  const settled = await recoverInstancesAction(lost.id, f.owner, f.deps);
  // Recovery settles the step from the SDK's record; the row completes only on an explicit resume.
  expect(settled.state).toBe("unknown");
  expect(settled.steps[0]).toMatchObject({ state: "succeeded", result: { result: { openId } } });
  const recovery = f.calls.at(-1)!;
  expect(recovery).toEqual(["op", "result", settled.steps[0]!.id, "--json"]);
  const dispatched = f.calls.length;
  const resumed = await f.admit("instances.open", input, lost.id);
  expect(resumed.state).toBe("succeeded");
  expect(f.calls.length).toBe(dispatched); // the recovered step replays; nothing is re-dispatched
});

test.each(["start", "stop", "hr"])(
  "a lost session %s reads its durable supervisor receipt and never re-dispatches",
  async (verb) => {
    const response = { state: "ok", id: "dev", legs: [] };
    const f = await setup((args) =>
      args[0] === "op"
        ? {
            result: {
              state: "ok",
              requestId: args[2],
              receipt: { requestId: args[2], key: `session.${verb}`, verdict: "ok" },
              response: JSON.parse(sdkEnvelope(response)),
            },
          }
        : Error("pe-revit produced no output"),
    );
    const key = `instances.${verb === "hr" ? "restart" : verb}`;
    const input =
      verb === "start"
        ? { year: "2025", owner: "you", addins: "on" }
        : { session, ...(verb === "stop" ? { unsaved: "keep" } : {}) };
    const lost = await f.admit(key, input);
    expect(lost.state).toBe("unknown");
    const settled = await recoverInstancesAction(lost.id, f.owner, f.deps);
    expect(settled.steps[0]).toMatchObject({ state: "succeeded", result: response });
    expect(f.calls.at(-1)).toEqual(["op", "result", lost.steps[0]!.id, "--json"]);
    const count = f.calls.length;
    expect((await f.admit(key, input, lost.id)).state).toBe("succeeded");
    expect(f.calls).toHaveLength(count);
    expect(f.calls.filter((args) => args[1] === verb)).toHaveLength(1);
  },
);

test("a repeated press launches again: nothing is staged, so nothing is consumed", async () => {
  const f = await setup(() => startedAnswer, []);
  const input = { year: "2025", owner: "you", addins: "on" };
  expect((await f.admit("instances.start", input)).state).toBe("succeeded");
  expect((await f.admit("instances.start", input)).state).toBe("succeeded");
  expect(f.calls.filter((argv) => argv[1] === "start")).toHaveLength(2);
});

test("SDK close refuses product references and wrong-source ids before mutation", async () => {
  const f = await setup(() => {
    throw Error("must not mutate");
  });
  await expect(
    f.admit("instances.close", {
      session,
      document: { session: "attachment", openId },
      unsaved: "keep",
    }),
  ).rejects.toThrow();
  expect(f.calls).toEqual([]);
  const refused = await f.admit("instances.close", {
    session,
    document: { source: "sdk", session: session.selection, openId: "product-open-id" },
    unsaved: "keep",
  });
  expect(refused.state).toBe("failed");
  expect(JSON.stringify(refused)).toContain("SDK document lifetime");
  expect(f.calls.map((args) => args.slice(0, 2))).toEqual([["doc", "list"]]);
});

test("restart, stop and close run for a human; stop and close require an unsaved choice", async () => {
  const f = await setup((args) =>
    args[0] === "session"
      ? { result: { id: "dev", state: "ok", phase: "ready" } }
      : { result: { state: "ok", openId } },
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

test("an action whose destination is not the supplied session is refused before it is admitted", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }));
  await expect(
    admitInstancesAction(
      {
        id: "foreign-destination",
        kind: "workflow",
        key: "instances.open",
        destination: { kind: "host" },
        input: { source: "C:/Tower.rvt", into: into() },
        bases: {},
      },
      crossingOf("agent"),
      f.owner,
      f.deps,
    ),
  ).rejects.toThrow("destination must match");
  expect(f.calls).toEqual([]);
});

test("open into your session remains human-only even with a grant", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }));
  bindControl({ heads: grantHead });
  await expect(
    f.admit("instances.open", { source: "C:/Mine.rvt", into: into() }, undefined, "agent"),
  ).rejects.toMatchObject({ refusal: { code: "human.only" } });
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
});

test("close checks only its exact document even with another ungranted document open", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }));
  bindControl({ heads: grantHead });
  f.census.documents = [openId, "b".repeat(32)];
  const input = {
    session,
    document: { source: "sdk", session: session.selection, openId },
    unsaved: "keep",
  };
  expect(await f.admit("instances.close", input, undefined, "agent")).toMatchObject({
    state: "succeeded",
    basis: { kind: "grant", lifetime: grantHead().grant!.lifetime },
  });
  await expect(
    f.admit(
      "instances.close",
      { ...input, document: { ...input.document, openId: "b".repeat(32) } },
      undefined,
      "agent",
    ),
  ).rejects.toMatchObject({ refusal: { code: "grant.other-lifetime" } });
});

test("a stale empty census cannot admit an agent stop", async () => {
  const f = await setup(() => ({ result: { state: "ok" } }));
  f.census.documents = [];
  await f.machine.refresh();
  f.census.fail = true;
  await expect(
    f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent"),
  ).rejects.toMatchObject({ refusal: { code: "lifecycle.ungranted-documents" } });
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
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

test.each([
  [{ kind: "self" }, undefined, []],
  [
    { kind: "save-as", out: "C:/out/Tower-copy.rvt", worksets: "strip" },
    undefined,
    ["--out", "C:/out/Tower-copy.rvt", "--worksets", "strip"],
  ],
  [
    { kind: "central", comment: "rooms renumbered" },
    "all",
    ["--central", "--comment", "rooms renumbered", "--release", "all"],
  ],
] as const)("save %o reaches doc save for the exact lifetime", async (to, release, expected) => {
  const f = await setup(() => ({ result: { state: "ok", openId } }));
  const row = await f.admit("instances.save", {
    session,
    document: sdkDocument,
    to,
    ...(release ? { release } : {}),
  });
  expect(row.state).toBe("succeeded");
  const save = f.calls.at(-1)!;
  expect(save.slice(0, 6)).toEqual(["doc", "save", "--doc", openId, "--id", "dev"]);
  expect(save.slice(6, 6 + expected.length)).toEqual(expected);
  expect(flag(save, "--expect-doc")).toBe(openId);
  expect(flag(save, "--expect-session")).toBe(receiptPath);
  expect(flag(save, "--request-id")).toBe(row.steps.at(-1)!.id);
});

test("save refuses states the SDK would refuse: comment without central, worksets without a Save As", () => {
  const input = instancesActions["instances.save"].input;
  for (const to of [
    { kind: "self", comment: "x" },
    { kind: "central", out: "C:/x.rvt" },
    { kind: "self", worksets: "strip" },
    // R6: the SDK's out is a Save As that retargets the open document; it is never called a copy.
    { kind: "copy", out: "C:/x.rvt" },
  ])
    expect(input.safeParse({ session, document: sdkDocument, to }).success).toBe(false);
});

test("an agent save is one document crossing: the granted lifetime admits, another refuses", async () => {
  const f = await setup(() => ({ result: { state: "ok", openId } }));
  bindControl({ heads: grantHead });
  f.census.documents = [openId, "b".repeat(32)];
  const input = { session, document: sdkDocument, to: { kind: "self" } };
  expect(await f.admit("instances.save", input, undefined, "agent")).toMatchObject({
    state: "succeeded",
    basis: { kind: "grant", lifetime: grantHead().grant!.lifetime },
  });
  await expect(
    f.admit(
      "instances.save",
      { ...input, document: { ...sdkDocument, openId: "b".repeat(32) } },
      undefined,
      "agent",
    ),
  ).rejects.toMatchObject({ refusal: { code: "grant.other-lifetime" } });
});

test("reset needs an unsaved choice and reaches session reset with release and restart", async () => {
  const f = await setup(() => ({ result: { id: "dev", state: "ok", phase: "ready" } }));
  await expect(f.admit("instances.reset", { session })).rejects.toThrow();
  expect(f.calls).toEqual([]);
  const row = await f.admit("instances.reset", {
    session,
    unsaved: "discard",
    release: "none",
    restart: true,
  });
  expect(row.state).toBe("succeeded");
  const reset = f.calls.at(-1)!;
  expect(reset.slice(0, 4)).toEqual(["session", "reset", "--id", "dev"]);
  expect(flag(reset, "--unsaved")).toBe("discard");
  expect(flag(reset, "--release")).toBe("none");
  expect(reset).toContain("--restart");
  expect(flag(reset, "--expect-session")).toBe(receiptPath);
  expect(flag(reset, "--request-id")).toBe(row.steps.at(-1)!.id);
});

const dialogList = {
  state: "ok",
  pid: originalProcess.pid,
  processStartUtc: originalProcess.processStartUtc,
  expectSession: receiptPath,
  windows: [{ handle: "0x1A2B", identity: { observationId: "fresh-dialog" } }],
};

test("dialog dismiss binds the fresh observation, exact process and action request", async () => {
  const f = await setup((args) => ({
    result: args.includes("--dismiss") ? { state: "ok" } : dialogList,
  }));
  f.census.documents = [];
  const result = await f.admit(
    "instances.dialogs",
    { session, hwnd: "0x1A2B" },
    undefined,
    "agent",
  );
  expect(result.state).toBe("succeeded");
  const calls = f.calls.filter((args) => args[1] === "dialogs");
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(["session", "dialogs", "--pid", String(originalProcess.pid), "--json"]);
  expect(flag(calls[1]!, "--expect-dialog")).toBe("fresh-dialog");
  expect(flag(calls[1]!, "--expect-session")).toBe(receiptPath);
  expect(flag(calls[1]!, "--pid")).toBe(String(originalProcess.pid));
  expect(flag(calls[1]!, "--request-id")).toBe(result.steps.at(-1)!.id);
});

test("dialog dismiss passes the SDK stale-identity refusal through as undispatched", async () => {
  const f = await setup((args) =>
    args.includes("--dismiss")
      ? {
          result: { state: "refused" },
          exitCode: 3,
          diagnostics: [
            { code: "session.dialog-identity-stale", detail: "Window replaced", fix: null },
          ],
        }
      : { result: dialogList },
  );
  const result = await f.admit("instances.dialogs", { session, hwnd: "0x1A2B" });
  expect(result.steps.at(-1)).toMatchObject({ state: "failed", notDispatched: true });
  const step = result.steps.at(-1)!;
  if (step.state !== "failed") throw Error("SDK refusal must fail the step");
  expect(step.error).toContain("session.dialog-identity-stale");
  expect(step.evidence).toMatchObject({
    result: {
      diagnostics: [
        { code: "session.dialog-identity-stale", detail: "Window replaced", fix: null },
      ],
    },
  });
});

test("a lost dialog dismiss recovers from its SDK receipt without replay", async () => {
  const f = await setup((args) => {
    if (args[0] === "op")
      return {
        result: {
          requestId: args[2],
          state: "ok",
          receipt: { requestId: args[2], key: "session.dialogs", verdict: "ok" },
          response: JSON.parse(sdkEnvelope({ state: "ok" })),
        },
      };
    return args.includes("--dismiss") ? Error("lost response") : { result: dialogList };
  });
  const lost = await f.admit("instances.dialogs", { session, hwnd: "0x1A2B" });
  expect(lost.steps.at(-1)!.state).toBe("unknown");
  const settled = await recoverInstancesAction(lost.id, f.owner, f.deps);
  expect(settled.steps.at(-1)!.state).toBe("succeeded");
  expect(f.calls.filter((args) => args.includes("--dismiss"))).toHaveLength(1);
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
