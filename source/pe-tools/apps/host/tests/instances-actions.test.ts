import { afterEach, expect, test } from "vite-plus/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { instancesRouteState, sdkSessionSelectorOf } from "@pe/agent-contracts";
import { RouteWorkspace } from "../../../packages/runtime/src/route-workspace.ts";
import { ActionJournal } from "../src/action-journal.ts";
import { admitInstancesAction, recoverInstancesAction } from "../src/instances-actions.ts";
import { originalProcess, sdkEnvelope } from "./native-receipt-fixture.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of cleanup.splice(0).reverse()) await f();
});

const scope = { route: "instances", target: null, work: "ws-1" };
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
  const stage = async (staged: unknown) => {
    const landed = await work.apply(
      scope,
      "instances",
      "human",
      [{ path: ["staged"], value: staged }],
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
  ) => {
    const row = await admitInstancesAction(
      {
        id: resume ?? `${key}-${++serial}`,
        kind: "workflow",
        key,
        actor: "human",
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
  return { calls, owner, deps, stage, admit, requestOf };
}

test("start dispatches the staged session under the step id with an absent expectation", async () => {
  const f = await setup(() => ({ result: { state: "started", id: "dev" } }), []);
  const revision = await f.stage({
    kind: "start",
    year: "2025",
    name: "dev",
    document: "C:/Tower.rvt",
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

  const foreign = await f.admit(
    "instances.open",
    { session: { id: "dev", process: { ...originalProcess, pid: 43 } } },
    revision,
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
