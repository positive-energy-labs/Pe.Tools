import { afterEach, expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instancesRouteState, sdkSessionSelectorOf, transitionPatches } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { admitInstancesAction, recoverInstancesAction } from "../src/instances-actions.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const scope = { binding: "workspace" as const, route: "instances", target: null, work: "ws-1" };
const session = { id: "dev", process: originalProcess };
const receiptPath = "C:/receipts/dev.json";

type Answer =
  | { result: unknown; diagnostics?: { code: string; detail: string; fix: null }[] }
  | Error;
async function setup(
  answer: (args: readonly string[]) => Answer | Promise<Answer>,
  sessionRows: readonly unknown[] = [
    {
      case: "controlled-active",
      id: "dev",
      process: originalProcess,
      receipt: { receiptPath },
    },
  ],
) {
  const dir = await mkdtemp(join(tmpdir(), "pe-instances-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const rows = new Map<string, unknown>();
  const work = new RouteWorkspace({
    registrations: [{ spec: instancesRouteState, handlers: {} }],
    store: {
      getState: async ({ targetKey, route }) => rows.get(targetKey + route),
      setState: async ({ targetKey, route, value }) => {
        rows.set(targetKey + route, structuredClone(value));
      },
    },
  });
  const calls: string[][] = [];
  const sdk = async (args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === "session" && args[1] === "list")
      return sdkEnvelope({
        sessions: sessionRows,
      });
    const reply = await answer(args);
    if (reply instanceof Error) throw reply;
    return JSON.stringify({
      ...JSON.parse(sdkEnvelope(reply.result)),
      diagnostics: reply.diagnostics ?? [],
    });
  };
  const owner = new ActionJournal(join(dir, "actions.json"));
  const deps = { workspace: work, sdk, requestDir: join(dir, "requests") };
  let workRevision = 0;
  // A person stages on the Work they see now: a host retirement may have moved it.
  const stage = async (staged: unknown) => {
    workRevision = (await work.read(scope, "instances"))?.revision ?? 0;
    const landed = await work.apply(
      scope,
      "instances",
      "human",
      transitionPatches([], "launch", {}, { kind: "stage", rung: { value: staged } }),
      workRevision,
    );
    expect(landed.ok).toBe(true);
    return (workRevision = landed.revision!);
  };
  let serial = 0;
  const admit = async (
    key: string,
    input: Record<string, unknown>,
    revision: number,
    resume?: string,
    actor: "human" | "agent" = "human",
  ) => {
    const row = await admitInstancesAction(
      {
        id: resume ?? `${key}-${++serial}`,
        kind: "workflow",
        key,
        actor,
        destination: "session" in input ? { kind: "session", session: "dev" } : { kind: "host" },
        input: { workspaceId: scope.work, ...input },
        bases: { work: { key: scope, revision } },
      },
      owner,
      deps,
      resume !== undefined,
    );
    return owner.wait(row.id);
  };
  const requestOf = async (id: string) =>
    JSON.parse(await readFile(join(deps.requestDir, `${id}.json`), "utf8"));
  // Pea's only write: a proposal on the launch cell, under the agent mask.
  const propose = async (value: unknown) => {
    const landed = await work.apply(
      scope,
      "instances",
      "agent",
      transitionPatches([], "launch", {}, { kind: "propose", rung: { value } }),
      workRevision,
    );
    expect(landed).toMatchObject({ ok: true });
    return (workRevision = landed.revision!);
  };
  const launch = async () =>
    instancesRouteState.schema.parse((await work.read(scope, "instances"))!.doc).launch;
  const revisionNow = async () => (workRevision = (await work.read(scope, "instances"))!.revision);
  return { calls, owner, deps, stage, propose, admit, requestOf, launch, revisionNow };
}

test("a Pea proposal never launches; the launch reads exactly what the person staged", async () => {
  const f = await setup(() => ({ result: { state: "started", id: "dev" } }), []);
  let revision = await f.propose({ kind: "start", year: "2026", name: "pea-pick" });
  const refused = await f.admit("instances.start", {}, revision);
  expect(refused.state).toBe("failed");
  expect(JSON.stringify(refused)).toContain("a person stages it first");
  expect(f.calls.filter((argv) => argv[1] === "start")).toEqual([]);

  // The person stages a different value; the standing proposal is not what launches.
  revision = await f.stage({ kind: "start", year: "2025", name: "dev" });
  const started = await f.admit("instances.start", {}, revision);
  expect(started.state).toBe("succeeded");
  const argv = f.calls.at(-1)!;
  expect(argv.slice(0, 2)).toEqual(["session", "start"]);
  expect(argv).toContain("2025");
  expect(argv).not.toContain("2026");
  expect(argv).not.toContain("pea-pick");
});

test("a Pea-proposed open never dispatches; the person stages it", async () => {
  const f = await setup(() => ({ result: { state: "opened", openId: "a".repeat(32) } }));
  const proposed = { kind: "open", session: sdkSessionSelectorOf("dev"), document: "C:/Pea.rvt" };
  const refused = await f.admit("instances.open", { session }, await f.propose(proposed));
  expect(refused.state).toBe("failed");
  expect(JSON.stringify(refused)).toContain("Pea proposed this open; a person stages it first");
  expect(f.calls.some((argv) => argv[0] === "doc")).toBe(false);

  const revision = await f.stage({ ...proposed, document: "C:/Tower.rvt", missingLinks: "allow" });
  expect((await f.admit("instances.open", { session }, revision)).state).toBe("succeeded");
  const open = f.calls.at(-1)!;
  expect(open.slice(0, 2)).toEqual(["doc", "open"]);
  expect(open).toContain("C:/Tower.rvt");
  expect(open).not.toContain("C:/Pea.rvt");
  expect(open.slice(open.indexOf("--missing-links"), open.indexOf("--missing-links") + 2)).toEqual([
    "--missing-links",
    "allow",
  ]);
});

test("start dispatches the staged session under the step id with an absent expectation", async () => {
  const f = await setup(() => ({ result: { state: "started", id: "dev" } }), []);
  const revision = await f.stage({
    kind: "start",
    year: "2025",
    name: "dev",
    document: "C:/Tower.rvt",
  });
  expect((await f.launch()).staged?.value).toMatchObject({
    quarantine: false,
    missingLinks: "refuse",
  });
  const receipt = await f.admit("instances.start", {}, revision);
  expect(receipt.state).toBe("succeeded");
  const step = receipt.steps[0]!;
  expect(step).toMatchObject({
    kind: "native",
    key: "instances.start",
    state: "succeeded",
    result: { id: "dev" },
  });
  const argv = f.calls.at(-1)!;
  expect(argv.slice(0, 2)).toEqual(["session", "start"]);
  expect(argv.slice(argv.indexOf("--missing-links"), argv.indexOf("--missing-links") + 2)).toEqual([
    "--missing-links",
    "refuse",
  ]);
  expect(argv).toContain("--request-file");
  expect(argv[argv.indexOf("--conflict-policy") + 1]).toBe("keep");
  const file = argv[argv.indexOf("--request-file") + 1]!;
  expect(file.endsWith(`${step.id}.json`)).toBe(true);
  expect(await f.requestOf(step.id)).toEqual({
    requestId: step.id,
    key: "session.start",
    session: { case: "absent" },
    document: null,
  });
  expect(argv).toContain("2025");
  expect(argv).toContain("C:/Tower.rvt");
  expect(argv).not.toContain("--quarantine");
});

test("only the person's staged quarantine choice reaches session start", async () => {
  const f = await setup(() => ({ result: { state: "started", id: "dev" } }), []);
  await f.propose({ kind: "start", year: "2025", name: "dev", quarantine: false });
  const revision = await f.stage({ kind: "start", year: "2025", name: "dev", quarantine: true });
  expect((await f.launch()).staged?.value).toMatchObject({ quarantine: true });
  expect((await f.admit("instances.start", {}, revision)).state).toBe("succeeded");
  expect(f.calls.at(-1)).toContain("--quarantine");
});

test("allowing missing links is staged explicitly for open and its omission result stays in the receipt", async () => {
  const nativeResult = {
    state: "opened",
    openId: "a".repeat(32),
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
  const revision = await f.stage({
    kind: "open",
    session: sdkSessionSelectorOf("dev"),
    document: "C:/Tower.rvt",
    missingLinks: "allow",
  });
  expect((await f.launch()).staged?.value).toMatchObject({ missingLinks: "allow" });
  const receipt = await f.admit("instances.open", { session }, revision);
  expect(receipt.state).toBe("succeeded");
  expect(receipt.steps[0]).toMatchObject({ state: "succeeded", result: nativeResult });
  const argv = f.calls.at(-1)!;
  expect(argv.slice(argv.indexOf("--missing-links"), argv.indexOf("--missing-links") + 2)).toEqual([
    "--missing-links",
    "allow",
  ]);
});

test("the default missing-links refusal keeps its SDK explanation and staged Work", async () => {
  const f = await setup(() => ({
    result: { state: "rejected" },
    diagnostics: [
      {
        code: "doc.missing-links",
        detail: "C:/Links/site.rvt was not found",
        fix: null,
      },
    ],
  }));
  const revision = await f.stage({
    kind: "open",
    session: sdkSessionSelectorOf("dev"),
    document: "C:/Tower.rvt",
  });
  const receipt = await f.admit("instances.open", { session }, revision);
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
  expect((await f.launch()).staged?.value).toMatchObject({ missingLinks: "refuse" });
});

test("start captures a gone session receipt so the SDK can retire that exact row", async () => {
  const f = await setup(
    () => ({ result: { state: "started", id: "dev" } }),
    [
      {
        case: "gone-receipt",
        id: "dev",
        process: originalProcess,
        receipt: { receiptPath },
      },
    ],
  );
  const revision = await f.stage({ kind: "start", year: "2025", name: "dev" });
  const receipt = await f.admit("instances.start", {}, revision);
  expect(receipt.state).toBe("succeeded");
  expect(await f.requestOf(receipt.steps[0]!.id)).toMatchObject({
    key: "session.start",
    session: { case: "recorded", receiptPath, process: originalProcess },
  });
  expect(f.calls.map((call) => call.slice(0, 2).join(" "))).toEqual([
    "session list",
    "session start",
  ]);
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
    return { result: { state: "opened" } };
  });
  const stage = (document: string) =>
    f.stage({
      kind: "open",
      session: sdkSessionSelectorOf("dev"),
      document,
    });
  let revision = await stage("C:/Tower.rvt");
  const original = f.admit("instances.open", { session }, revision);
  await dispatched;
  try {
    expect(await f.admit("instances.open", { session }, revision)).toMatchObject({
      state: "failed",
      notDispatched: true,
      error: expect.stringContaining("already opening"),
    });
    revision = await stage("C:/Other.rvt");
    expect((await f.admit("instances.open", { session }, revision)).state).toBe("succeeded");
  } finally {
    release();
  }
  const lost = await original;
  expect(lost.state).toBe("unknown");
  revision = await stage("C:/Tower.rvt");
  expect((await f.admit("instances.open", { session }, revision)).state).toBe("succeeded");
  expect((await f.owner.list(undefined, lost.id))[0]?.state).toBe("unknown");
  expect(f.calls.filter((args) => args[0] === "doc")).toHaveLength(3);
});

test("open binds the exact recorded incarnation and its receipt path; a foreign incarnation is refused undispatched", async () => {
  const f = await setup(() => ({ result: { state: "opened", openId: "a".repeat(32) } }));
  const revision = await f.stage({
    kind: "open",
    session: sdkSessionSelectorOf("dev"),
    document: "C:/Tower.rvt",
  });
  const receipt = await f.admit("instances.open", { session }, revision);
  expect(receipt.state).toBe("succeeded");
  const step = receipt.steps[0]!;
  expect(await f.requestOf(step.id)).toEqual({
    requestId: step.id,
    key: "doc.open",
    session: {
      case: "recorded",
      receiptPath,
      process: {
        pid: 42,
        processStartUtc: originalProcess.processStartUtc,
        executable: originalProcess.executable,
      },
    },
    document: { case: "absent" },
  });
  expect(f.calls.map((c) => c.slice(0, 2).join(" "))).toEqual(["session list", "doc open"]);
  const open = f.calls.at(-1)!;
  expect(open[open.indexOf("--conflict-policy") + 1]).toBe("keep");

  // The proven open retired its staged launch; the person stages it again for the foreign attempt.
  const restaged = await f.stage({
    kind: "open",
    session: sdkSessionSelectorOf("dev"),
    document: "C:/Tower.rvt",
  });
  const foreign = await f.admit(
    "instances.open",
    { session: { id: "dev", process: { ...originalProcess, pid: 43 } } },
    restaged,
  );
  expect(foreign).toMatchObject({ state: "failed", notDispatched: true });
  expect(f.calls.at(-1)?.slice(0, 2)).toEqual(["session", "list"]);
});

test("a pre-admission SDK refusal is failed and undispatched; recovery settles a lost answer from the SDK record", async () => {
  let mode: "refuse" | "hang" | "answer" = "refuse";
  const f = await setup((args) => {
    if (args[0] === "op")
      return {
        result: {
          state: "completed",
          requestId: args[2],
          key: "session.start",
          ownerPid: 1,
          admittedUtc: "x",
          response: { state: "started", id: "dev" },
        },
      };
    if (mode === "refuse")
      return {
        result: { state: "refused" },
        diagnostics: [
          { code: "op.stale-expectation", detail: "a session 'dev' already exists", fix: null },
        ],
      };
    if (mode === "hang") return Error("pe-revit produced no output");
    return { result: { state: "started" } };
  });
  const revision = await f.stage({ kind: "start", year: "2025", name: "dev" });
  const refused = await f.admit("instances.start", {}, revision);
  expect(refused).toMatchObject({
    state: "failed",
    notDispatched: true,
    error: expect.stringContaining("op.stale-expectation"),
  });

  mode = "hang";
  const lost = await f.admit("instances.start", {}, revision);
  expect(lost.state).toBe("unknown");
  mode = "answer";
  const settled = await recoverInstancesAction(lost.id, f.owner, f.deps);
  // Recovery settles the step from the SDK's record; the row completes only on an explicit resume.
  expect(settled.state).toBe("unknown");
  expect(settled.steps[0]).toMatchObject({ state: "succeeded", result: { id: "dev" } });
  const recovery = f.calls.at(-1)!;
  expect(recovery.slice(0, 2)).toEqual(["op", "result"]);
  expect(recovery[2]).toBe(settled.steps[0]!.id);
  expect(recovery).toContain("--request-file");
  const dispatched = f.calls.length;
  const resumed = await f.admit("instances.start", {}, revision, lost.id);
  expect(resumed.state).toBe("succeeded");
  expect(f.calls.length).toBe(dispatched); // the recovered step replays; nothing is re-dispatched
});

test("a proven start retires the consumed staged launch; a second press does not start again", async () => {
  const f = await setup(() => ({ result: { state: "started", id: "dev" } }), []);
  const spec = { kind: "start", year: "2025", name: "dev" };
  const revision = await f.stage(spec);
  expect((await f.admit("instances.start", {}, revision)).state).toBe("succeeded");
  expect((await f.launch()).staged).toBeNull();
  const again = await f.admit("instances.start", {}, await f.revisionNow());
  expect(again.state).toBe("failed");
  expect(JSON.stringify(again)).toContain("Stage a start first");
  expect(f.calls.filter((argv) => argv[1] === "start")).toHaveLength(1);
});

test("a failed start keeps the staged launch for the person to retry", async () => {
  const f = await setup(
    () => ({
      result: { state: "refused" },
      diagnostics: [{ code: "op.stale-expectation", detail: "a session 'dev' exists", fix: null }],
    }),
    [],
  );
  const revision = await f.stage({ kind: "start", year: "2025", name: "dev" });
  expect((await f.admit("instances.start", {}, revision)).state).toBe("failed");
  expect((await f.launch()).staged).toEqual({
    value: {
      kind: "start",
      year: "2025",
      name: "dev",
      quarantine: false,
      missingLinks: "refuse",
    },
  });
});

test("a Pea-admitted start of the person's staged launch retires it too", async () => {
  const f = await setup(() => ({ result: { state: "started", id: "dev" } }), []);
  const revision = await f.stage({ kind: "start", year: "2025", name: "dev" });
  const row = await f.admit("instances.start", {}, revision, undefined, "agent");
  expect(row.state).toBe("succeeded");
  expect((await f.launch()).staged).toBeNull();
});

test("an SDK refusal that ran nothing settles failed (hr would-drop); an advisory diagnostic keeps success", async () => {
  const f = await setup((args) =>
    args[0] === "session"
      ? {
          result: { id: "dev", state: "would-drop", documents: [] },
          diagnostics: [
            { code: "session.hr-would-drop", detail: "2 open document(s) are headless", fix: null },
          ],
        }
      : {
          result: { state: "ok", openId: "a".repeat(32) },
          diagnostics: [{ code: "doc.file-year-unread", detail: "cloud: not-local", fix: null }],
        },
  );
  const revision = await f.stage({
    kind: "open",
    session: sdkSessionSelectorOf("dev"),
    document: "C:/Tower.rvt",
  });
  const restart = await f.admit("instances.restart", { session }, revision);
  expect(restart).toMatchObject({ state: "failed", notDispatched: true });
  expect(JSON.stringify(restart)).toContain("session.hr-would-drop");

  expect((await f.admit("instances.open", { session }, revision)).state).toBe("succeeded");
});
