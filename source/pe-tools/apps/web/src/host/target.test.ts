import { describe, expect, it } from "vite-plus/test";

import { resolveTarget, type SessionFacts } from "./target";

const user: SessionFacts = {
  sessionId: "aaa111",
  processId: 4128,
  lane: "installed",
  activeDocumentTitle: "Tower-A.rvt",
  openDocumentCount: 1,
};
const sandbox: SessionFacts = {
  sessionId: "bbb222",
  processId: 9204,
  lane: "sandbox",
  sandboxId: "fam-lab",
  activeDocumentTitle: "Door-Single.rfa",
  activeDocumentIsFamilyDocument: true,
  openDocumentCount: 1,
};

describe("resolveTarget", () => {
  it("empty selector: sole session resolves implicit, two is ambiguous, none is unresolved", () => {
    expect(resolveTarget([user], "")).toMatchObject({ kind: "resolved", mode: "implicit" });
    expect(resolveTarget([user, sandbox], "")).toMatchObject({ kind: "ambiguous" });
    expect(resolveTarget([], "")).toMatchObject({ kind: "unresolved", reason: "no-sessions" });
  });

  it("selector forms: user lane, sandbox id, pid, raw session id", () => {
    const all = [user, sandbox];
    expect(resolveTarget(all, "user")).toMatchObject({
      mode: "pinned",
      session: { sessionId: "aaa111" },
    });
    expect(resolveTarget(all, "sandbox:fam-lab")).toMatchObject({
      session: { sessionId: "bbb222" },
    });
    expect(resolveTarget(all, "9204")).toMatchObject({ session: { sessionId: "bbb222" } });
    expect(resolveTarget(all, "aaa111")).toMatchObject({ session: { sessionId: "aaa111" } });
  });

  it("a pin dangles as no-match when its process dies, and re-resolves against a new incarnation", () => {
    expect(resolveTarget([sandbox], "user")).toMatchObject({
      kind: "unresolved",
      reason: "no-match",
    });
    const reborn: SessionFacts = { ...user, sessionId: "ccc333", processId: 5330 };
    expect(resolveTarget([reborn, sandbox], "user")).toMatchObject({
      kind: "resolved",
      session: { sessionId: "ccc333" },
    });
  });

  it("an unknown-lane session never matches `user`, mirroring the host", () => {
    const unlaned: SessionFacts = { ...user, sessionId: "eee555", lane: "unknown" };
    expect(resolveTarget([unlaned], "user")).toMatchObject({
      kind: "unresolved",
      reason: "no-match",
    });
  });

  it("a selector matching multiple sessions is ambiguous, mirroring the host 409", () => {
    const secondUser: SessionFacts = { ...user, sessionId: "ddd444", processId: 7777 };
    expect(resolveTarget([user, secondUser], "user")).toMatchObject({ kind: "ambiguous" });
  });
});
