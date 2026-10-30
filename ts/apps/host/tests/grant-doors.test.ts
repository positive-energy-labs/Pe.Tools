import { invokeCommand } from "./command-fixture.ts";
/**
 * HTTP-level falsifiers for doors 1-3 (WAVE1-PLAN §2): the route is production code, the caller is
 * minted the way the identity middleware would, and every refusal is read off the wire. Each test
 * pins the refusal code AND the sentence the person reads (door, reason, remedy), because the web
 * renders `refusal` verbatim; a reworded string is a contract change.
 */
import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpRouter } from "effect/unstable/http";
import {
  emptyThreadHead,
  type Caller,
  type DocumentRef,
  type ThreadHead,
} from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { admitCrossing, bindControl } from "../src/control.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { human, pea } from "./callers.ts";

const docA: DocumentRef = { session: "S1", openId: "A" };
const docB: DocumentRef = { session: "S2", openId: "B" };
const mcp: Caller = { kind: "external-mcp", context: "mcp-1", label: "some client" };
const page: Caller = { kind: "page", page: "page:@pages/todo" };
const anonymous: Caller = { kind: "anonymous" };

let root: string;
let journal: ActionJournal;
let web: ReturnType<typeof HttpRouter.toWebHandler>;
let heads: Record<string, ThreadHead> = {};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pe-grant-doors-"));
  journal = new ActionJournal(join(root, "journal.json"));
  web = HttpRouter.toWebHandler(
    makeCallRoute(
      journal,
      new TakeoffCaptures(join(root, "captures")),
      { sdk: sdkSessions },
      {
        forwardBase: null,
        // `pod.list` is host-local: it answers without Revit, so a read needs no bridge.
        dispatch: () => Effect.succeed({ pods: [] }),
      },
    ).pipe(Layer.provideMerge(Layer.succeed(RevitBridge, {} as RevitBridge["Service"]))),
    { disableLogger: true },
  );
  // Every document is in a session the person owns, unless a test says otherwise.
  bindControl({ heads: (thread) => heads[thread] ?? emptyThreadHead });
});
afterEach(async () => {
  heads = {};
  bindControl({ heads: null, acquired: () => null, acquiredSession: () => null });
  await web.dispose();
  await rm(root, { recursive: true, force: true });
});

/** A head whose one target a human added. */
const headWith = (ref: DocumentRef): ThreadHead => ({
  targets: [
    {
      request: { kind: "open", ref },
      admission: { revision: 3, at: "2026-10-12T12:00:00.000Z", via: "local" },
    },
  ],
  revision: 3,
});

type Wire = { status: number; json: Record<string, any> };
const send = (
  as: Caller,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<Wire> =>
  withInvocationContext({ caller: as }, async () => {
    const response = await web.handler(
      new Request(`http://host${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
      Context.empty() as never,
    );
    return { status: response.status, json: (await response.json()) as Record<string, any> };
  });

const admission = (ref: DocumentRef = docA, id = "door-2") => ({
  id,
  // A human-only key would answer human.only first for a Pea caller; this one is open to both.
  key: "scripting.execute",
  target: { kind: "document" as const, ref },
  // A ReadOnly script is a read for Pea (items 9, 10); the grant doors judge a write.
  input: { permissionMode: "WriteTransaction" },
});
const hostWrite = () => ({
  id: "causal-host-write",
  key: "pod.member.write",
  target: { kind: "host" },
  input: { pod: "doors", path: "settings/door.json", content: "{}" },
});

/** A door refusal on the wire: 403, never dispatched, the typed code, and the sentence. */
const refused = (wire: Wire, code: string) => {
  expect([wire.status, wire.json.refusal?.code, wire.json.notDispatched]).toEqual([
    403,
    code,
    true,
  ]);
  expect(wire.json.error).toBe(wire.json.message);
  expect(wire.json.refusal.door).toBe("/actions");
};

/* ── Door 1: POST /call ────────────────────────────────────────────────────────────────── */

test("door 1: a read is free for every caller, anonymous included; a mutation is never dispatched", async () => {
  for (const as of [anonymous, page, mcp, pea(), human]) {
    const read = await send(as, "/call", { key: "pod.list" });
    expect([as.kind, read.status]).toEqual([as.kind, 200]);
    expect(read.json).toEqual({ pods: [] });
  }
  // An anonymous caller is refused before classification: it may only read Pods (Pe.App's callbacks).
  const anonymousWrite = await send(anonymous, "/call", { key: "pod.member.write", request: {} });
  expect([
    anonymousWrite.status,
    anonymousWrite.json.refusal?.code,
    anonymousWrite.json.refusal?.door,
  ]).toEqual([403, "context.missing", "/call"]);
  expect(anonymousWrite.json.notDispatched).toBe(true);
  for (const as of [pea(), human]) {
    const write = await send(as, "/call", { key: "pod.member.write", request: {} });
    expect([as.kind, write.status, write.json.notDispatched]).toEqual([as.kind, 409, true]);
  }
});

test("door 2: Pea session crossings do not inherit thread grants; writes still need a causal run", async () => {
  heads.t1 = headWith(docA);
  expect(admitCrossing(pea("t1"), { kind: "session", session: "S1" }, "/actions")).toBeNull();
  refused(await send(pea("t1"), "/actions", hostWrite()), "run.none");
});

test("door 2: a thread target cannot substitute for causal run identity", async () => {
  heads.t1 = headWith(docB);
  expect(admitCrossing(pea("t1"), { kind: "document", ref: docA }, "/actions")).toBeNull();
  refused(await send(pea("t1"), "/actions", hostWrite()), "run.none");
});

test("door 2: an unpaired external MCP client cannot write your document", async () => {
  refused(await send(mcp, "/actions", admission()), "grant.context-cannot-hold");
});

/* ── Door 3: POST /actions/{resume,cancel,recover} ─────────────────────────────────────── */

/** A receipt a human admitted, settled, ready to be controlled by someone else. */
async function humanReceipt(id: string) {
  const seeded = new ActionJournal(join(root, "journal.json"));
  await invokeCommand(
    seeded,
    {
      ...admission(docA, id),
      caller: human,
      basis: { kind: "human" },
    },
    async () => ({}),
    async () => ({}),
  );
  await seeded.wait(id);
}

test("door 3: resume re-crosses under the current caller and never inherits the original basis", async () => {
  await humanReceipt("door-3-resume");
  // The original was a human's; an anonymous resume does not borrow that.
  const wire = await send(anonymous, "/actions/resume", { id: "door-3-resume" });
  expect([wire.status, wire.json.refusal?.code, wire.json.notDispatched]).toEqual([
    403,
    "context.missing",
    true,
  ]);
  expect(wire.json.refusal.door).toBe("/actions");
  // A Pea context whose thread does not target it is refused for the same row, not the human's pass.
  const agent = await send(pea("t1"), "/actions/resume", { id: "door-3-resume" });
  expect([agent.status, agent.json.refusal?.code]).toEqual([403, "context.foreign-thread"]);
});

test("the human RHVAC launch RPC refuses every other caller before dispatch", async () => {
  for (const caller of [pea(), mcp, page, anonymous]) {
    const result = await send(caller, "/call", {
      key: "rhvac.launch",
      request: { path: "test.r10" },
    });
    expect(result).toMatchObject({
      status: 403,
      json: { notDispatched: true, error: "Only a person can launch RHVAC" },
    });
  }
  expect(
    await send(human, "/call", { key: "rhvac.launch", request: { path: "test.r10" } }),
  ).toMatchObject({ status: 200 });
});
