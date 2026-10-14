/**
 * HTTP-level falsifiers for doors 1-3 (WAVE1-PLAN §2): the route is production code, the caller is
 * minted the way the identity middleware would, and every refusal is read off the wire. Each test
 * pins the refusal code AND the sentence the person reads (door, reason, remedy), because the web
 * renders `refusal` verbatim; a reworded string is a contract change.
 */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { Context, Effect, Layer } from "effect";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpRouter } from "effect/unstable/http";
import {
  emptyThreadHead,
  type Caller,
  type DocumentRef,
  type HeadGrant,
  type ThreadHead,
} from "@pe/agent-contracts";
import { withInvocationContext } from "@pe/runtime/context";
import { ActionJournal } from "../src/action-journal.ts";
import { RevitBridge } from "../src/bridge.ts";
import { makeCallRoute } from "../src/call-route.ts";
import { bindControl, grantExpiry } from "../src/control.ts";
import { TakeoffCaptures } from "../src/takeoff-captures.ts";
import { sdkSessions } from "./native-receipt-fixture.ts";
import { human, pea } from "./callers.ts";

const T0 = Date.parse("2026-10-12T12:00:00.000Z");
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 1000);
});
afterEach(async () => {
  vi.useRealTimers();
  heads = {};
  bindControl({ heads: null, acquired: () => null, acquiredSession: () => null });
  await web.dispose();
  await rm(root, { recursive: true, force: true });
});

const grantOn = (lifetime: DocumentRef, extra: Partial<HeadGrant> = {}): HeadGrant => ({
  lifetime,
  grantedAt: new Date(T0).toISOString(),
  grantedVia: "local",
  expiresAt: grantExpiry(T0),
  revoked: null,
  ...extra,
});
const headWith = (grant: HeadGrant): ThreadHead => ({
  ...emptyThreadHead,
  defaultTarget: { kind: "open", ref: grant.lifetime },
  revision: 3,
  grant,
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
  kind: "workflow",
  // A human-only key would answer human.only first for a Pea caller; this one is open to both.
  key: "scripting.execute",
  destination: { kind: "document", ref },
  input: {},
  bases: {},
});

/** A door refusal on the wire: 403, never dispatched, the typed code, and the sentence. */
const refused = (wire: Wire, code: string, message: string) => {
  expect([wire.status, wire.json.refusal?.code, wire.json.notDispatched]).toEqual([
    403,
    code,
    true,
  ]);
  // The wire carries the code in front of the reason, as `Refused` renders itself.
  expect(wire.json.message).toBe(`${code}: ${message}`);
  expect(wire.json.error).toBe(wire.json.message);
  expect(wire.json.refusal.door).toBe("/actions");
  expect(wire.json.refusal.reason).toBe(message);
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
    expect(write.json.message).toBe(
      "Submit the original exact admission to /actions; raw mutation dispatch is retired",
    );
  }
});

test("door 1: a body-borne or header-borne identity is not identity", async () => {
  const body = await send(anonymous, "/call", { key: "pod.list", actor: "human" });
  expect(body.status).toBe(400);
  expect(body.json.message).toMatch(/actor/);
  // The header changes nothing: the read is free, the mutation is retired, for the same reasons.
  const header = await send(
    anonymous,
    "/call",
    { key: "pod.member.write", request: {} },
    { "x-pe-action-actor": "human" },
  );
  expect([header.status, header.json.refusal?.code, header.json.refusal?.door]).toEqual([
    403,
    "context.missing",
    "/call",
  ]);
  expect(header.json.notDispatched).toBe(true);
});

/* ── Door 2: POST /actions ─────────────────────────────────────────────────────────────── */

test("door 2: no caller context is context.missing and says where to run it from", async () => {
  refused(
    await send(anonymous, "/actions", admission()),
    "context.missing",
    "Refused at /actions: no caller context. Anonymous loopback calls are read-only; run this from Pea, the web app, or a bound Page.",
  );
});

test("door 2: a Page is sent to its own door", async () => {
  refused(
    await send(page, "/actions", admission()),
    "page.use-page-door",
    "Pages act through /pages/todo/act, not /actions.",
  );
});

test("door 2: Pea with no grant on your document is grant.required, naming the document and the remedy", async () => {
  const wire = await send(pea("t1"), "/actions", admission());
  refused(
    wire,
    "grant.required",
    "Refused at /actions: this would write your document S1/A, and thread t1 holds no rw grant on it. Point this thread at it in the composer to grant rw, or open a copy.",
  );
  expect(wire.json.refusal).toMatchObject({
    remedy: "Point this thread at the document in the composer.",
    lifetime: docA,
  });
});

test("door 2: a grant covers one document, never a session", async () => {
  heads.t1 = headWith(grantOn(docA));
  refused(
    await send(pea("t1"), "/actions", {
      ...admission(),
      destination: { kind: "session", session: "S1" },
    }),
    "grant.required",
    "Refused at /actions: this would act on your Revit session 'S1', and a thread grant covers one document, never a session.",
  );
});

test("door 2: a grant on another lifetime of the same file is grant.other-lifetime", async () => {
  heads.t1 = headWith(grantOn(docB));
  const wire = await send(pea("t1"), "/actions", admission(docA));
  refused(
    wire,
    "grant.other-lifetime",
    "Refused at /actions: rw is granted on S2/B, not on S1/A. A per-call override writes only Pea's documents or the granted head.",
  );
  expect(wire.json.refusal.lifetime).toEqual(docB);
});

test("door 2: an expired grant says when and how it renews", async () => {
  heads.t1 = headWith(grantOn(docA));
  vi.setSystemTime(T0 + 61 * 60_000);
  refused(
    await send(pea("t1"), "/actions", admission()),
    "grant.expired",
    "Refused at /actions: rw expired at 13:00 (60 min after your last message). Send a message in the thread to renew.",
  );
});

test("door 2: a revoked grant says so and how to grant again", async () => {
  heads.t1 = headWith(grantOn(docA, { revoked: { at: new Date(T0 + 500).toISOString() } }));
  refused(
    await send(pea("t1"), "/actions", admission()),
    "grant.revoked",
    "Refused at /actions: rw was revoked at 12:00. Steps already running finish; nothing new starts. Re-point the head to grant again.",
  );
});

test("door 2: an external MCP client cannot hold rw on your document", async () => {
  refused(
    await send(mcp, "/actions", admission()),
    "grant.context-cannot-hold",
    "Refused at /actions: external-mcp has no product write authority.",
  );
});

test("door 2: human-only keys refuse an agent, and a body actor or actor header is not identity", async () => {
  bindControl({ acquired: () => "acq-1" });
  const humanOnly = { ...admission(), key: "family.build" };
  refused(
    await send(pea("t1"), "/actions", humanOnly, { "x-pe-action-actor": "human" }),
    "human.only",
    "'family.build' is human-only; pea calls are refused.",
  );
  const spoofed = await send(pea("t1"), "/actions", { ...humanOnly, actor: "human" });
  expect(spoofed.status).toBe(409);
  expect(spoofed.json.error).toMatch(/actor/);
});

/* ── Door 3: POST /actions/{resume,cancel,recover} ─────────────────────────────────────── */

/** A receipt a human admitted, settled, ready to be controlled by someone else. */
async function humanReceipt(id: string) {
  await journal.admit(
    {
      ...admission(docA, id),
      kind: "workflow" as const,
      caller: human,
      basis: { kind: "human" },
    } as never,
    async () => ({}),
    async () => ({}),
  );
  await journal.wait(id);
}

test("door 3: cancel and recover belong to a human or the admitting context", async () => {
  await humanReceipt("door-3");
  for (const verb of ["cancel", "recover"]) {
    const door = `/actions/${verb}`;
    const foreign = await send(pea("t9"), door, { id: "door-3" });
    expect([verb, foreign.status, foreign.json.refusal?.code]).toEqual([verb, 403, "human.only"]);
    expect(foreign.json.message).toBe(
      `human.only: Refused at ${door}: only a human or the caller that admitted 'door-3' may ${verb} it.`,
    );
    const none = await send(anonymous, door, { id: "door-3" });
    expect([verb, none.status, none.json.refusal?.code]).toEqual([verb, 403, "context.missing"]);
  }
});

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
  // A Pea context without a grant gets the grant refusal for the same row, not the human's pass.
  const agent = await send(pea("t1"), "/actions/resume", { id: "door-3-resume" });
  expect([agent.status, agent.json.refusal?.code]).toEqual([403, "grant.required"]);
});
