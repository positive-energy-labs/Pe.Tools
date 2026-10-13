import { afterEach, expect, test } from "vite-plus/test";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instancesActions, instancesSessionSelection } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { admitInstancesAction, recoverInstancesAction } from "../src/instances-actions.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";
import { crossingOf } from "./callers.ts";

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
const controlledRow = (over: Record<string, unknown> = {}) => ({
  case: "controlled-active",
  id: "dev",
  process: originalProcess,
  receipt: { receiptPath },
  shape: shape("foreground"),
  ...over,
});
const observed = { selection: { pid: 4242 }, process: { ...originalProcess, pid: 4242 } };
const observedRow = {
  case: "observed-active",
  process: observed.process,
  shape: shape("foreground"),
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
        ...JSON.parse(sdkEnvelope({ state: "ok", documents: [{ openId }] })),
        resolved: { ...process, id: "dev" },
      });
    }
    const reply = await answer(args);
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
  return { calls, owner, deps, admit, dir, peaWork, file };
}

async function recordPeaLaunch(owner: ActionJournal) {
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
    async () => null,
    async () => startedAnswer.result,
  );
  await owner.wait(launch.id);
}

const into = (id = "dev") => ({ session: { id } });
const newRevit = (over: Record<string, unknown> = {}) => ({
  start: { year: "2025", owner: "you", addins: "on", ...over },
});

test.each(["stop", "close", "restart"])(
  "agent %s on your session is human.only and never dispatches",
  async (verb) => {
    const f = await setup(() => ({ result: { state: "ok" } }));
    const receipt = await f.admit(
      `instances.${verb}`,
      {
        session,
        ...(verb !== "restart" ? { unsaved: "keep" } : {}),
        ...(verb === "close"
          ? { document: { source: "sdk", session: session.selection, openId } }
          : {}),
      },
      undefined,
      "agent",
    );
    expect(receipt).toMatchObject({ state: "failed", notDispatched: true });
    expect(receipt).toHaveProperty("error", expect.stringContaining("human.only"));
    expect(f.calls.every((args) => args[1] === "list")).toBe(true);
  },
);

test("a user's own background run stays you and refuses agent stop", async () => {
  const f = await setup(
    () => ({ result: { state: "ok" } }),
    [controlledRow({ shape: shape("background") })],
  );
  const receipt = await f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent");
  expect(receipt).toMatchObject({ state: "failed", notDispatched: true });
  expect(receipt).toHaveProperty("error", expect.stringContaining("human.only"));
  expect(f.calls.every((args) => args[1] === "list")).toBe(true);
});

test.each(["start", "open"])(
  "a succeeded Pea %s receipt admits agent stop of that background process",
  async (verb) => {
    const f = await setup(
      (args) => (args[1] === "start" ? startedAnswer : { result: { state: "ok", openId } }),
      [controlledRow({ shape: shape("background") })],
    );
    const launch = await f.admit(
      `instances.${verb}`,
      verb === "start"
        ? { year: "2025", owner: "pea", addins: "on" }
        : { source: "cld://US/{p}p/{m}Tower.rvt", into: newRevit({ owner: "pea" }) },
    );
    expect(launch.state).toBe("succeeded");
    expect(
      (await f.admit("instances.stop", { session, unsaved: "keep" }, undefined, "agent")).state,
    ).toBe("succeeded");
    expect(f.calls.at(-1)!.slice(0, 2)).toEqual(["session", "stop"]);
  },
);

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
  expect(argv).not.toContain("--id");
  expect(f.calls.map((call) => call.slice(0, 2).join(" "))).toEqual(["session start"]);
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
  expect(flag(open, "--unsynced")).toBe("keep");
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
  for (const name of ["--detach", "--upgrade", "--reload", "--template"])
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

test("a Pea launch of a workshared model opens detached and is not copied", async () => {
  const f = await setup(
    () => ({ result: { state: "ok", openId } }),
    [controlledRow({ id: "pea-bg", shape: shape("background") })],
  );
  await recordPeaLaunch(f.owner);
  const source = await f.file("Central.rvt", "Worksharing: Local");
  const receipt = await f.admit("instances.open", { source, into: into("pea-bg") });
  expect(receipt.state).toBe("succeeded");
  const open = f.calls.at(-1)!;
  expect(open[2]).toBe(source);
  expect(open).toContain("--detach");
  expect(existsSync(f.peaWork)).toBe(false);
  expect((receipt as { result?: unknown }).result).toMatchObject({
    opened: source,
    copiedFrom: null,
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
    (await f.admit("instances.open", { source, into: into() }, undefined, "agent")).state,
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
