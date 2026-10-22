import { afterEach, expect, test, vi } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyThreadHead,
  address,
  type Caller,
  type DocumentRef,
  type HeadGrant,
  type ThreadHead,
} from "@pe/agent-contracts";
import {
  admitCrossing,
  bindControl,
  callerOf,
  grantExpiry,
  live,
  Refused,
  admitScript,
  mintPageDoor,
  consentedRead,
  writeTerminalContext,
} from "../src/control.ts";
import { HOST_CONTEXT_HEADER, productPathNames } from "@pe/host-contracts/contracts";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";

const T0 = Date.parse("2026-10-12T12:00:00.000Z");
const docA: DocumentRef = { session: "S1", openId: "A" };
// The same saved Address open in a second Revit: a different lifetime.
const docB: DocumentRef = { session: "S2", openId: "B" };
const pea: Caller = { kind: "pea", context: "c1", thread: "t1" };

const grantOn = (lifetime: DocumentRef, extra: Partial<HeadGrant> = {}): HeadGrant => ({
  lifetime,
  grantedAt: new Date(T0).toISOString(),
  grantedVia: "local",
  expiresAt: grantExpiry(T0),
  revoked: null,
  ...extra,
});

test("access-004 K9: a granted script refuses another ungranted open document", () => {
  bind(acquiredCopy);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 1000);
  heads.t1 = headWith(grantOn(docA));
  expect(
    refusal(() => admitScript(pea, [docA, { session: "S1", openId: "other" }], "/actions")),
  ).toBe("script.ungranted-documents");
  expect(() => admitScript(pea, [docA], "/actions")).not.toThrow();
  expect(() => admitScript(pea, [{ session: "P", openId: "copy" }], "/actions")).not.toThrow();
});
const headWith = (grant: HeadGrant | null): ThreadHead => ({
  ...emptyThreadHead,
  defaultTarget: grant ? { kind: "open", ref: grant.lifetime } : null,
  revision: 3,
  grant,
});
let heads: Record<string, ThreadHead> = {};
/** Pea acquired one copy in Revit "P"; a user document opened there later is not acquired. */
const acquiredCopy = (ref: DocumentRef) =>
  ref.session === "P" && ref.openId === "copy" ? "acq-copy" : null;

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
  bindControl({ heads: null, acquired: () => null, acquiredSession: () => null });
  vi.useRealTimers();
});

test("access-052: re-grant on the same lifetime cannot revive an older admission", () => {
  bind();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 1000);
  heads.t1 = headWith(grantOn(docA));
  const basis = admitCrossing(pea, { kind: "document", ref: docA }, "/actions");
  heads.t1 = { ...headWith(grantOn(docA)), revision: 5 };
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
