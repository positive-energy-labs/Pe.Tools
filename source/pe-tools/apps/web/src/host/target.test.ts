import { describe, expect, it } from "vite-plus/test";

import {
  documentAddress,
  fromBridgeSessions,
  mintSelector,
  resolveTarget,
  selectorLabel,
  type SessionFacts,
} from "./target";

it("projects process-start identity from the bridge sessions transport", () => {
  expect(
    fromBridgeSessions([
      {
        sessionId: "bridge-a",
        connected: true,
        processId: 4128,
        processStartUtcUnixMs: 1_752_000_000_000,
        lane: "dev",
        custody: "observed",
        openDocumentCount: 0,
      },
    ])[0],
  ).toMatchObject({ processId: 4128, processStartUtcUnixMs: 1_752_000_000_000 });
});

/** The user's own Revit: pe-revit holds no receipt for it, so custody is `observed`. */
const observed: SessionFacts = {
  sessionId: "aaa111",
  processId: 4128,
  processStartUtcUnixMs: 1_000,
  lane: "installed",
  custody: "observed",
  activeDocumentId: "C:\\Models\\Tower-A.rvt",
  activeDocumentTitle: "Tower-A.rvt",
  openDocumentCount: 1,
};
/** A pe-revit-launched session: it carries the session id `session status` prints. */
const controlled: SessionFacts = {
  sessionId: "bbb222",
  processId: 9204,
  processStartUtcUnixMs: 2_000,
  lane: "installed",
  custody: "controlled",
  sdkSessionId: "fam-lab",
  activeDocumentTitle: "Door-Single.rfa",
  openDocumentCount: 1,
};

describe("resolveTarget", () => {
  it("empty selector: sole session resolves implicit, two is ambiguous, none is unresolved", () => {
    expect(resolveTarget([observed], "")).toMatchObject({ kind: "resolved", mode: "implicit" });
    expect(resolveTarget([observed, controlled], "")).toMatchObject({ kind: "ambiguous" });
    expect(resolveTarget([], "")).toMatchObject({ kind: "unresolved", reason: "no-sessions" });
  });

  it("selector forms: custody, lane, pe-revit session id, pid, raw bridge session id", () => {
    const all = [observed, controlled];
    expect(resolveTarget(all, "observed")).toMatchObject({
      mode: "pinned",
      session: { sessionId: "aaa111" },
    });
    expect(resolveTarget(all, "controlled")).toMatchObject({
      session: { sessionId: "bbb222" },
    });
    expect(resolveTarget(all, "session:fam-lab")).toMatchObject({
      session: { sessionId: "bbb222" },
    });
    expect(resolveTarget(all, "9204")).toMatchObject({ session: { sessionId: "bbb222" } });
    expect(resolveTarget(all, "aaa111")).toMatchObject({ session: { sessionId: "aaa111" } });
  });

  it("the retired selector words resolve nothing — they miss, they do not silently mean something else", () => {
    const all = [observed, controlled];
    for (const retired of ["user", "sandbox:fam-lab"])
      expect(resolveTarget(all, retired)).toMatchObject({ kind: "unresolved", reason: "no-match" });
  });

  it("a pin dangles as no-match when its process dies, and re-resolves against a new incarnation", () => {
    expect(resolveTarget([controlled], "observed")).toMatchObject({
      kind: "unresolved",
      reason: "no-match",
    });
    const reborn: SessionFacts = { ...observed, sessionId: "ccc333", processId: 5330 };
    expect(resolveTarget([reborn, controlled], "observed")).toMatchObject({
      kind: "resolved",
      session: { sessionId: "ccc333" },
    });
  });

  it("a lane-less session never matches a lane selector, mirroring the host", () => {
    const unlaned: SessionFacts = { ...observed, sessionId: "eee555", lane: null };
    expect(resolveTarget([unlaned], "installed")).toMatchObject({
      kind: "unresolved",
      reason: "no-match",
    });
    // …but it is still reachable by custody and by pid: refusing lane vocabulary is not exile.
    expect(resolveTarget([unlaned], "observed")).toMatchObject({ kind: "resolved" });
    expect(resolveTarget([unlaned], "4128")).toMatchObject({ kind: "resolved" });
  });

  it("a selector matching multiple sessions is ambiguous, mirroring the host 409", () => {
    const second: SessionFacts = { ...observed, sessionId: "ddd444", processId: 7777 };
    expect(resolveTarget([observed, second], "observed")).toMatchObject({ kind: "ambiguous" });
  });
});

describe("mintSelector", () => {
  it("prefers the pe-revit session id, then custody, then pid", () => {
    // The SDK mints this id and it survives a restart under the same name.
    expect(mintSelector(controlled, [observed, controlled])).toBe("session:fam-lab");
    // No SDK id and sole session of its custody: `observed` survives restarts, a pid does not.
    expect(mintSelector(observed, [observed, controlled])).toBe("observed");
    const second: SessionFacts = { ...observed, sessionId: "ddd444", processId: 7777 };
    // Two observed sessions: `observed` would be ambiguous, so fall back to the pid that dies
    // with the process rather than mint a selector that resolves to the wrong Revit.
    expect(mintSelector(observed, [observed, second])).toBe("4128");
  });
});

describe("documentAddress", () => {
  it("names the document without world identity or custody restrictions", () => {
    expect(documentAddress(observed)).toBe("C:\\Models\\Tower-A.rvt");
    expect(documentAddress({ ...observed, activeDocumentId: undefined })).toBeNull();
  });

  it("renders unsupported Revit document paths unbound", () => {
    expect(documentAddress({ ...observed, activeDocumentId: "RSN://server/model.rvt" })).toBeNull();
    expect(
      documentAddress({ ...observed, activeDocumentId: "Autodesk Docs://project/model.rvt" }),
    ).toBeNull();
  });
});

describe("selectorLabel", () => {
  it("shows the id itself for a session pin, and names a pid as a pid", () => {
    expect(selectorLabel("")).toBe("auto");
    expect(selectorLabel("session:fam-lab")).toBe("fam-lab");
    expect(selectorLabel("4128")).toBe("pid 4128");
    expect(selectorLabel("observed")).toBe("observed");
  });
});
