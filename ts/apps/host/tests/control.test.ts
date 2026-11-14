import { admittedRequestIdentity } from "../src/request-services.ts";
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
  originOf,
  bindControl,
  callerOf,
  live,
  Refused,
  admitScript,
  mintPageDoor,
  consentedRead,
  readsOnly,
  writeTerminalContext,
} from "../src/control.ts";
import { HOST_CONTEXT_HEADER, productPathNames } from "@pe/host-contracts/contracts";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import { hostOwnership } from "../src/host-ownership.ts";

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

test("Pea scripts do not borrow authority from thread targets; their full footprint enters consent", () => {
  bind(acquiredCopy);
  heads.t1 = headWith([docA]);
  expect(() =>
    admitScript(pea, [docA, { session: "S1", openId: "other" }], "/actions"),
  ).not.toThrow();
});
let heads: Record<string, ThreadHead> = {};
/** Pea acquired one copy in Revit "P"; a user document opened there later is not acquired. */
const acquiredCopy = (ref: DocumentRef) =>
  ref.session === "P" && ref.openId === "copy" ? "acq-copy" : null;

// Contract C1: native runs a Pod entrypoint that names no mode in the mode pod.json declares, which
// may write, so the host calls it a read only when the run says ReadOnly. Mutant, run red once:
// restore `(permissionMode ?? "ReadOnly") === "ReadOnly"` for every run (the fourth line fails: a
// declared WriteTransaction entrypoint would cross as a consented read).
test("a script run is a read only when its mode is known to be ReadOnly", () => {
  expect(readsOnly("scripting.execute", {})).toBe(true);
  expect(readsOnly("scripting.execute", { scriptContent: "Result(1);" })).toBe(true);
  expect(readsOnly("scripting.execute", { sourcePath: "src/A.cs", permissionMode: "ReadOnly" })).toBe(true);
  expect(readsOnly("scripting.execute", { sourcePath: "src/A.cs" })).toBe(false);
  expect(readsOnly("scripting.execute", { scriptContent: "x", permissionMode: "NoTransaction" })).toBe(false);
  expect(readsOnly("revit.context.summary", { permissionMode: "ReadOnly" })).toBe(false);
});

test("Pea capability stays independent of thread targets", () => {
  bind();
  heads.t1 = headWith([docA]);
  expect(admitCrossing(pea, { kind: "document", ref: docA }, "/actions")).toBeNull();
  expect(admitCrossing(pea, { kind: "document", ref: docB }, "/actions")).toBeNull();
  expect(admitCrossing(pea, { kind: "session", session: "S2" }, "/actions")).toBeNull();
  heads.t1 = emptyThreadHead;
  expect(admitCrossing(pea, { kind: "document", ref: docA }, "/actions")).toBeNull();
});

test("external device target removal revokes its own transport exception", async () => {
  bind();
  bindControl({ deviceThread: () => "t1" });
  heads.t1 = headWith([docA]);
  const external: Caller = { kind: "external-mcp", context: "m", label: "device", device: "d1" };
  const basis = admitCrossing(external, { kind: "document", ref: docA }, "/actions");
  heads.t1 = emptyThreadHead;
  expect((await live(basis))?.refusal.code).toBe("grant.revoked");
});

test("an external MCP device writes only its thread's human-added targets", () => {
  bindControl({
    heads: (thread) => heads[thread] ?? emptyThreadHead,
    deviceThread: (device) => (device === "d1" ? "t1" : null),
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
    expect(admitCrossing(identity.caller, { kind: "document", ref: docA }, "/actions"))
      .toEqual({ kind: "person-pin", page: "page:@pages/pin", boundBy: "human", lifetime: docA });
    expect(refusal(() => admitCrossing(identity.caller, { kind: "document", ref: docB }, "/actions")))
      .toBe("grant.required");
    expect(() => admitScript(identity.caller, [docA], "/actions")).not.toThrow();
    expect(refusal(() => admitScript(identity.caller, [docA, docB], "/actions")))
      .toBe("script.ungranted-documents");
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
    // Even an acquisition elsewhere cannot widen this person's pin to another lifetime.
    bind((ref) => ref.openId === docB.openId ? "acq-other" : null);
    expect(refusal(() => admitCrossing(identity.caller, { kind: "document", ref: docB }, "/actions")))
      .toBe("grant.required");
  } finally {
    minted.retire();
  }
});
test("an agent Page pin cannot borrow a person's write consent", () => {
  bind();
  const minted = mintPageDoor("page:@pages/pin",
    { kind: "pinned", address: address("C:/Jobs/Pin.rvt") }, "/pages/pin/act", false, docA);
  try {
    const identity = callerOf({ kind: "local" }, { [HOST_CONTEXT_HEADER]: minted.token });
    if ("refusal" in identity) throw Error(identity.refusal.detail);
    expect(refusal(() => admitCrossing(identity.caller, { kind: "document", ref: docA }, "/actions")))
      .toBe("grant.required");
    bind(() => "acq-copy");
    expect(admitCrossing(identity.caller, { kind: "document", ref: docA }, "/actions"))
      .toMatchObject({ kind: "acquisition", id: "acq-copy" });
  } finally { minted.retire(); }
});
const bind = (acquired: (ref: DocumentRef) => string | null = () => null) =>
  bindControl({
    heads: (thread) => heads[thread] ?? emptyThreadHead,
    acquired,
    acquiredSession: (session) => (acquired === acquiredCopy && session === "P" ? "acq-P" : null),
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
  bindControl({
    heads: null,
    acquired: () => null,
    acquiredSession: () => null,
    deviceThread: undefined,
  });
});

test("re-adding a target cannot revive an external device's older admission", async () => {
  bind();
  bindControl({ deviceThread: () => "t1" });
  heads.t1 = headWith([docA]);
  const external: Caller = { kind: "external-mcp", context: "m", label: "device", device: "d1" };
  const basis = admitCrossing(external, { kind: "document", ref: docA }, "/actions");
  heads.t1 = headWith([docA], 5);
  expect((await live(basis))?.refusal.code).toBe("grant.revoked");
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
    const path = hostContextTokenPath(hostOwnership.rootPath, "host-dev");
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

test("a page native read keeps only its minted door through request admission", () => {
  bind();
  const minted = mintPageDoor("page:@pages/pin", {
    kind: "pinned", address: address("C:/Jobs/Pin.rvt"),
  }, "/pages/pin/act", true, docA);
  try {
    const transport = callerOf({ kind: "local" }, { [HOST_CONTEXT_HEADER]: minted.token });
    if ("refusal" in transport) throw Error(transport.refusal.detail);
    const identity = admittedRequestIdentity(transport.caller, {});
    expect(identity.caller).toBe(transport.caller);
    expect(Object.isFrozen(identity.caller)).toBe(true);
    expect(Reflect.set(transport.caller, "page", "page:@pages/other")).toBe(false);
    expect(originOf(identity.caller).caller).toEqual({ kind: "page", page: "page:@pages/pin" });
    expect(JSON.stringify(originOf(identity.caller))).not.toContain(minted.token);
    expect(admitCrossing(identity.caller, { kind: "document", ref: docA }, "/call", true)).toBeNull();
    const unminted = admittedRequestIdentity({ kind: "page", page: "page:@pages/pin" }, {});
    expect(refusal(() => admitCrossing(unminted.caller, { kind: "document", ref: docA }, "/call", true)))
      .toBe("page.use-page-door");
    minted.retire();
    expect(() => admitCrossing(identity.caller, { kind: "document", ref: docA }, "/call", true)).toThrow(Refused);
  } finally { minted.retire(); }
});

test("request admission preserves a human caller's native authority", () => {
  bind();
  const caller: Caller = { kind: "human", via: "local" };
  const identity = admittedRequestIdentity(caller, {});
  expect(identity.caller).toBe(caller);
  expect(Object.isFrozen(caller)).toBe(true);
  expect(admitCrossing(identity.caller, { kind: "document", ref: docA }, "/call", true))
    .toEqual({ kind: "human" });
});
