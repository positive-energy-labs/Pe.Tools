import { afterEach, expect, test, vi } from "vite-plus/test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
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
  mintContext,
  mintBrowserContext,
  Refused,
  retireContext,
  admitScript,
  mintPageDoor,
  consentedRead,
  writeTerminalContext,
} from "../src/control.ts";
import { HOST_CONTEXT_HEADER, productPathNames } from "@pe/host-contracts/contracts";
import { hostContextTokenPath } from "@pe/host-contracts/service-identity";
import { ActionJournal } from "../src/action-journal.ts";

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

const browser = {
  cookie: mintBrowserContext({ kind: "local" }).split(";")[0],
  origin: "http://127.0.0.1:5180",
  "x-pe-runtime-service": "pe-host",
};

test("callerOf mints from the transport: token, Referer, or anonymous", () => {
  const local = { kind: "local" } as const;
  expect(callerOf(local, {})).toEqual({ caller: { kind: "anonymous" } });
  // A self-asserted actor header is not identity.
  expect(callerOf(local, { "x-pe-action-actor": "human" })).toEqual({
    caller: { kind: "anonymous" },
  });
  expect(callerOf(local, { ...browser, referer: "http://127.0.0.1:5180/chat" })).toEqual({
    caller: { kind: "human", via: "local" },
  });
  expect(
    callerOf(
      { kind: "tailnet", login: "kait@example.com", authority: "box" },
      {
        ...browser,
        cookie: mintBrowserContext({
          kind: "tailnet",
          login: "kait@example.com",
          authority: "box",
        }).split(";")[0],
        referer: "https://box/open",
      },
    ),
  ).toEqual({ caller: { kind: "human", via: "tailnet", login: "kait@example.com" } });
  expect(callerOf(local, { ...browser, referer: "http://127.0.0.1:5180/pages/todo/" })).toEqual({
    caller: { kind: "page", page: "page:@pages/todo" },
  });
  expect(
    callerOf(local, { ...browser, referer: "http://127.0.0.1:5180/pages/ducts--tour/x.html" }),
  ).toEqual({ caller: { kind: "page", page: "page:@ducts/pages/tour" } });
  // No Referer, or no runtime marker: not provably the web app.
  expect(callerOf(local, browser)).toEqual({ caller: { kind: "anonymous" } });
  expect(
    callerOf(local, { origin: browser.origin, referer: "http://127.0.0.1:5180/chat" }),
  ).toEqual({ caller: { kind: "anonymous" } });
  const token = mintContext({ kind: "pea", thread: "t9" });
  expect(callerOf(local, { "x-pe-context": token })).toMatchObject({
    caller: { kind: "pea", thread: "t9" },
  });
  // A browser may never present a context, and an unminted token is unknown.
  expect(
    callerOf(local, { ...browser, referer: "http://x/chat", "x-pe-context": token }),
  ).toMatchObject({ refusal: { code: "context.unknown" } });
  expect(callerOf(local, { "x-pe-context": "forged" })).toMatchObject({
    refusal: { code: "context.unknown" },
  });
  retireContext(token);
  expect(callerOf(local, { "x-pe-context": token })).toMatchObject({
    refusal: { code: "context.unknown" },
  });
});

test("an anonymous write is context.missing and a page is sent to its own door", () => {
  bind();
  const destination = { kind: "document", ref: docA } as const;
  expect(refusal(() => admitCrossing({ kind: "anonymous" }, destination, "/actions"))).toBe(
    "context.missing",
  );
  expect(
    refusal(() => admitCrossing({ kind: "page", page: "page:@pages/x" }, destination, "/actions")),
  ).toBe("page.use-page-door");
  expect(admitCrossing({ kind: "human", via: "local" }, destination, "/actions")).toEqual({
    kind: "human",
  });
});

test("pea needs the grant on the exact lifetime; only a document Pea acquired needs none", () => {
  bind(acquiredCopy);
  const on = (ref: DocumentRef) => ({ kind: "document", ref }) as const;
  expect(refusal(() => admitCrossing(pea, on(docA), "/actions"))).toBe("grant.required");
  expect(refusal(() => admitCrossing(pea, { kind: "session", session: "S1" }, "/actions"))).toBe(
    "grant.required",
  );
  expect(admitCrossing(pea, on({ session: "P", openId: "copy" }), "/actions")).toEqual({
    kind: "acquisition",
    id: "acq-copy",
    scope: { kind: "document", lifetime: { session: "P", openId: "copy" } },
  });
  // A user's document B opened inside Pea's Revit inherits nothing from the process.
  expect(refusal(() => admitCrossing(pea, on({ session: "P", openId: "B" }), "/actions"))).toBe(
    "grant.required",
  );
  expect(admitCrossing(pea, { kind: "session", session: "P" }, "/actions")).toEqual({
    kind: "acquisition",
    id: "acq-P",
    scope: { kind: "process", session: "P" },
  });
  expect(admitCrossing(pea, { kind: "host" }, "/actions")).toBeNull();
  heads.t1 = headWith(grantOn(docA));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 1000);
  expect(admitCrossing(pea, on(docA), "/actions")).toEqual({
    kind: "grant",
    thread: "t1",
    headRevision: 3,
    lifetime: docA,
  });
  // F-b: two Revits hold the same Address; the grant names one lifetime, never the Address.
  expect(refusal(() => admitCrossing(pea, on(docB), "/actions"))).toBe("grant.other-lifetime");
  // External MCP remains read-only, including Pea's documents.
  const external: Caller = { kind: "external-mcp", context: "x", label: "Claude Desktop" };
  expect(refusal(() => admitCrossing(external, on(docA), "mcp:pe_do"))).toBe(
    "grant.context-cannot-hold",
  );
  expect(
    refusal(() => admitCrossing(external, on({ session: "P", openId: "copy" }), "mcp:pe_do")),
  ).toBe("grant.context-cannot-hold");
  // The step-begin check holds only while that acquisition still holds that exact lifetime.
  const basis = admitCrossing(pea, on({ session: "P", openId: "copy" }), "/actions");
  expect(live(basis)).toBeNull();
  bind();
  expect(live(basis)?.refusal.code).toBe("acquisition.unproven");
});

test("a grant expires 60 minutes after it was stamped, and a revoked one is refused", () => {
  bind();
  vi.useFakeTimers({ toFake: ["Date"] });
  heads.t1 = headWith(grantOn(docA));
  const basis = { kind: "grant", thread: "t1", headRevision: 3, lifetime: docA } as const;
  vi.setSystemTime(T0 + 59 * 60_000);
  expect(live(basis)).toBeNull();
  vi.setSystemTime(T0 + 60 * 60_000);
  expect(live(basis)?.refusal.code).toBe("grant.expired");
  expect(refusal(() => admitCrossing(pea, { kind: "document", ref: docA }, "/actions"))).toBe(
    "grant.expired",
  );
  vi.setSystemTime(T0 + 1000);
  heads.t1 = headWith(grantOn(docA, { revoked: { at: new Date(T0).toISOString() } }));
  expect(live(basis)?.refusal.code).toBe("grant.revoked");
  // A move retires the grant: the basis names a lifetime the head no longer grants.
  heads.t1 = headWith(grantOn(docB));
  expect(live(basis)?.refusal.code).toBe("grant.revoked");
  expect(live({ kind: "human" })).toBeNull();
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

test("revoke between steps: the begun step reports, the next is refused grant.revoked unsent", async () => {
  bind();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0 + 1000);
  heads.t1 = headWith(grantOn(docA));
  const dir = await mkdtemp(join(tmpdir(), "pe-control-"));
  try {
    const journal = new ActionJournal(join(dir, "actions.json"));
    const sent: string[] = [];
    const id = randomUUID();
    await journal.admit(
      {
        id,
        kind: "workflow",
        key: "test.two-steps",
        destination: { kind: "document", ref: docA },
        input: {},
        bases: {},
        caller: pea,
        basis: { kind: "grant", thread: "t1", headRevision: 3, lifetime: docA },
      },
      async () => ({}),
      async (execution) => {
        await execution.step("native", "first", {}, async () => void sent.push("first"));
        heads.t1 = headWith(grantOn(docA, { revoked: { at: new Date().toISOString() } }));
        await execution.step("native", "second", {}, async () => void sent.push("second"));
      },
    );
    const row = await journal.wait(id);
    expect(sent, JSON.stringify(row)).toEqual(["first"]);
    expect(row.caller).toEqual(pea);
    expect(row.steps.map((step) => [step.key, step.state])).toEqual([
      ["first", "succeeded"],
      ["second", "failed"],
    ]);
    expect(row.steps[1]).toMatchObject({ notDispatched: true, status: 403 });
    expect((row.steps[1] as { error: string }).error).toContain("grant.revoked");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
