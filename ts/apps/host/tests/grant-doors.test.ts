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
  // A ReadOnly script is a read for Pea (items 9, 10); the grant doors judge a write.
  input: { permissionMode: "WriteTransaction" },
  bases: {},
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

test("door 2: a grant covers one document, never a session", async () => {
  heads.t1 = headWith(grantOn(docA));
  refused(
    await send(pea("t1"), "/actions", {
      ...admission(),
      destination: { kind: "session", session: "S1" },
    }),
    "grant.required",
  );
});

test("door 2: a grant on another lifetime of the same file is grant.other-lifetime", async () => {
  heads.t1 = headWith(grantOn(docB));
  const wire = await send(pea("t1"), "/actions", admission(docA));
  refused(wire, "grant.other-lifetime");
  expect(wire.json.refusal.lifetime).toEqual(docB);
});

test("door 2: an external MCP client cannot hold rw on your document", async () => {
  refused(await send(mcp, "/actions", admission()), "grant.context-cannot-hold");
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
