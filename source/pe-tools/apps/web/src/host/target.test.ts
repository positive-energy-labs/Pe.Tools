import { describe, expect, it } from "vite-plus/test";

import { address, emptyScope, type Scope } from "@pe/agent-contracts";

import { documentAddress, fromBridgeSessions, scopeSession, type SessionFacts } from "./target";

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
        openDocuments: [],
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

describe("scopeSession", () => {
  const at = (document: string, pin?: string): Scope => ({
    kind: "document",
    document: address(document),
    ...(pin ? { pin } : {}),
  });

  it("resolves the sole session when the Scope names nothing", () => {
    expect(scopeSession(emptyScope, [observed])).toBe(observed);
    expect(scopeSession(emptyScope, [observed, controlled])).toBeNull();
    expect(scopeSession(emptyScope, [])).toBeNull();
  });

  it("resolves the one holder of the Scope's document, and refuses when nobody holds it", () => {
    expect(scopeSession(at("C:\\Models\\Tower-A.rvt"), [observed, controlled])).toBe(observed);
    expect(scopeSession(at("C:\\Models\\Nowhere.rvt"), [observed, controlled])).toBeNull();
  });

  it("lets a pin break a tie between two holders, by pe-revit id then by broker id", () => {
    const twin: SessionFacts = { ...controlled, activeDocumentId: observed.activeDocumentId };
    const document = "C:\\Models\\Tower-A.rvt";
    expect(scopeSession(at(document), [observed, twin])).toBeNull();
    expect(scopeSession(at(document, "fam-lab"), [observed, twin])).toBe(twin);
    expect(scopeSession(at(document, "aaa111"), [observed, twin])).toBe(observed);
  });
});
