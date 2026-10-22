import { afterEach, expect, test } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyThreadHead,
  address,
  type Caller,
  type DocumentRef,
  type ThreadHead,
} from "@pe/agent-contracts";
import {
  admitCrossing,
  bindControl,
  callerOf,
  live,
  Refused,
  admitScript,
  mintPageDoor,
  consentedRead,
  writeTerminalContext,
} from "../src/control.ts";
import { HOST_CONTEXT_HEADER, productPathNames } from "@pe/host-contracts/contracts";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";

const docA: DocumentRef = { session: "S1", openId: "A" };
// The same saved Address open in a second Revit: a different lifetime.
const docB: DocumentRef = { session: "S2", openId: "B" };
const pea: Caller = { kind: "pea", context: "c1", thread: "t1" };

/** A head whose targets a human added at `revision`. */
const headWith = (lifetimes: DocumentRef[], revision = 3): ThreadHead => ({
  targets: lifetimes.map((ref) => ({
    request: { kind: "open", ref },
    admission: { revision, at: "2026-10-12T12:00:00.000Z", via: "local" },
  })),
  revision,
});

test("access-004 K9: a script on a target refuses another open document Pea may not write", () => {
  bind(acquiredCopy);
  heads.t1 = headWith([docA]);
  expect(
    refusal(() => admitScript(pea, [docA, { session: "S1", openId: "other" }], "/actions")),
  ).toBe("script.ungranted-documents");
  expect(() => admitScript(pea, [docA], "/actions")).not.toThrow();
  expect(() => admitScript(pea, [{ session: "P", openId: "copy" }], "/actions")).not.toThrow();
  // Under Full every open document is one Pea may write, so K9 finds no sibling to refuse.
  full = true;
  expect(() =>
    admitScript(pea, [docA, { session: "S1", openId: "other" }], "/actions"),
  ).not.toThrow();
});
let heads: Record<string, ThreadHead> = {};
let full = false;
/** Pea acquired one copy in Revit "P"; a user document opened there later is not acquired. */
const acquiredCopy = (ref: DocumentRef) =>
  ref.session === "P" && ref.openId === "copy" ? "acq-copy" : null;

test("ADR 0021: Full writes any open document; Guarded refuses a user document the thread does not target", () => {
  bind();
  heads.t1 = headWith([docA]);
  expect(refusal(() => admitCrossing(pea, { kind: "document", ref: docB }, "/actions"))).toBe(
    "grant.required",
  );
  expect(admitCrossing(pea, { kind: "document", ref: docA }, "/actions")).toEqual({
    kind: "grant",
    thread: "t1",
    headRevision: 3,
    lifetime: docA,
  });
  full = true;
  const basis = admitCrossing(pea, { kind: "document", ref: docB }, "/actions");
  expect(basis).toEqual({ kind: "full-access", thread: "t1", lifetime: docB });
  // A thread still targets documents, never a session, under either setting.
  expect(refusal(() => admitCrossing(pea, { kind: "session", session: "S2" }, "/actions"))).toBe(
    "grant.required",
  );
  // Switching back to Guarded stops a Full admission at step begin.
  expect(live(basis)).toBeNull();
  full = false;
  expect(live(basis)?.refusal.code).toBe("grant.revoked");
});

test("ADR 0021: a human removing a target ends its authority; there is no clock", () => {
  bind();
  heads.t1 = headWith([docA, docB]);
  const basis = admitCrossing(pea, { kind: "document", ref: docA }, "/actions");
  expect(live(basis)).toBeNull();
  heads.t1 = { ...headWith([docB]), revision: 4 };
  expect(live(basis)?.refusal.code).toBe("grant.revoked");
  expect(refusal(() => admitCrossing(pea, { kind: "document", ref: docA }, "/actions"))).toBe(
    "grant.required",
  );
});

test("an external MCP device writes only its thread's human-added targets, never under Full", () => {
  bindControl({
    heads: (thread) => heads[thread] ?? emptyThreadHead,
    deviceThread: (device) => (device === "d1" ? "t1" : null),
    fullAccess: () => true,
  });
  heads.t1 = headWith([docA]);
  const mcp: Caller = { kind: "external-mcp", context: "m", label: "MCP", device: "d1" };
  expect(admitCrossing(mcp, { kind: "document", ref: docA }, "/actions")).toMatchObject({
    kind: "grant",
    device: "d1",
  });
  expect(refusal(() => admitCrossing(mcp, { kind: "document", ref: docB }, "/actions"))).toBe(
    "grant.required",
  );
});

test("a human Page pin consents only to the exact minted document lifetime", () => {
  bind();
  const minted = mintPageDoor(
    "page:@pages/pin",
    { kind: "pinned", address: address("C:/Jobs/Pin.rvt") },
    "/pages/pin/act",
    true,
    docA,
  );
  try {
    const identity = callerOf({ kind: "local" }, { "x-pe-context": minted.token });
    if ("refusal" in identity) throw Error(identity.refusal.detail);
    expect(consentedRead(identity.caller, "scripting.execute", {}, docA)).toBe(true);
    expect(consentedRead(identity.caller, "scripting.execute", {}, docB)).toBe(false);
    expect(
      consentedRead(
        identity.caller,
        "scripting.execute",
        { permissionMode: "WriteTransaction" },
        docA,
      ),
    ).toBe(false);
    expect(
      refusal(() =>
        admitCrossing(identity.caller, { kind: "document", ref: docB }, "/actions", true),
      ),
    ).toBe("grant.required");
    expect(refusal(() => admitScript(identity.caller, [docA, docB], "/actions", docB))).toBe(
      "script.ungranted-documents",
    );
  } finally {
    minted.retire();
  }
});
const bind = (acquired: (ref: DocumentRef) => string | null = () => null) =>
  bindControl({
    heads: (thread) => heads[thread] ?? emptyThreadHead,
    acquired,
    acquiredSession: (session) => (acquired === acquiredCopy && session === "P" ? "acq-P" : null),
    fullAccess: () => full,
  });
const refusal = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof Refused) return error.refusal.code;
    throw error;
  }
  return "admitted";
};

afterEach(() => {
  heads = {};
  full = false;
  bindControl({
    heads: null,
    acquired: () => null,
    acquiredSession: () => null,
    deviceThread: undefined,
    fullAccess: () => false,
  });
});

test("access-052: re-adding the same lifetime cannot revive an older admission", () => {
  bind();
  heads.t1 = headWith([docA]);
  const basis = admitCrossing(pea, { kind: "document", ref: docA }, "/actions");
  heads.t1 = headWith([docA], 5);
  expect(live(basis)?.refusal.code).toBe("grant.revoked");
});

/**
 * Acceptance R4d: surviving Revit spawned an attach host while a replacement host started; the
 * first retired and removed the shared `.context` the settled host had written, so the owner's
 * CLI could no longer act as human. A host removes the file only while it still holds its token.
 */
test("a retiring host leaves the terminal context another host wrote since", async () => {
  const home = await mkdtemp(join(tmpdir(), "pe-terminal-context-"));
  const prior = process.env[productPathNames.productHomeVariable];
  process.env[productPathNames.productHomeVariable] = home;
  try {
    const path = hostContextTokenPath("host-dev");
    const first = writeTerminalContext("host-dev");
    const settled = writeTerminalContext("host-dev");
    const token = readFileSync(path, "utf8");
    first.retire();
    expect(readFileSync(path, "utf8")).toBe(token);
    expect(callerOf({ kind: "local" }, { [HOST_CONTEXT_HEADER]: token })).toEqual({
      caller: { kind: "human", via: "cli" },
    });
    settled.retire();
    expect(existsSync(path)).toBe(false);
  } finally {
    if (prior === undefined) delete process.env[productPathNames.productHomeVariable];
    else process.env[productPathNames.productHomeVariable] = prior;
    await rm(home, { recursive: true, force: true });
  }
});
