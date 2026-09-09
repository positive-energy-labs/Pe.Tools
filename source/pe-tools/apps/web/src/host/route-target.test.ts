import { describe, expect, it } from "vite-plus/test";
import { address } from "@pe/agent-contracts";
import { routeTarget } from "./route-target";
import type { SessionFacts } from "./target";

const document = address("C:\\Models\\Chosen.rvt");
const session: SessionFacts = {
  sessionId: "process-1",
  sdkSessionId: "tk-0",
  processId: 1,
  custody: "controlled",
  lane: "dev",
  openDocumentCount: 2,
  activeDocumentId: "C:\\Models\\Other.rvt",
  openDocuments: [
    {
      openId: "chosen-open",
      address: document,
      title: "Chosen",
      isActive: false,
      isFamilyDocument: false,
    },
  ],
};
const ready: Parameters<typeof routeTarget>[1] = {
  worlds: [
    {
      id: "tk-0",
      brokerSessionId: "process-1",
      custody: "controlled",
      phase: "ready",
      detail: "",
      session,
    },
  ],
  sessions: [session],
  unreadableReceipts: [],
  processReadErrors: [],
  registryRoot: undefined,
  isLoading: false,
  stale: false,
  error: null,
  at: 1,
  basis: [],
};
const scope = { kind: "document" as const, document, pin: "tk-0" };

describe("route target admission", () => {
  it("binds an inactive document in the explicit process", () => {
    expect(routeTarget(scope, ready)).toMatchObject({
      kind: "ready",
      session: { sessionId: "process-1", openDocumentId: "chosen-open" },
    });
    expect(routeTarget({ ...scope, pin: "process-1" }, ready)).toMatchObject({ kind: "ready" });
  });
  it("requires an explicit session even when another process holds the document", () => {
    expect(routeTarget({ kind: "document", document }, ready).kind).toBe("pick");
    expect(routeTarget({ ...scope, pin: "ended" }, ready).kind).toBe("gone");
  });
  it("distinguishes an outage, a failed read, closure, and an absent document", () => {
    const disconnected = {
      ...ready,
      sessions: [],
      worlds: [{ ...ready.worlds[0]!, session: undefined, phase: "unresponsive" as const }],
    };
    expect(routeTarget(scope, disconnected).kind).toBe("checking");
    expect(routeTarget({ ...scope, pin: "process-1" }, disconnected).kind).toBe("checking");
    expect(routeTarget({ ...scope, pin: "ended" }, disconnected).kind).toBe("gone");
    expect(routeTarget(scope, { ...ready, error: Error("host unavailable") }).kind).toBe(
      "unavailable",
    );
    expect(
      routeTarget(scope, {
        ...disconnected,
        worlds: [{ ...disconnected.worlds[0]!, phase: "gone" }],
      }).kind,
    ).toBe("gone");
    const empty = { ...session, openDocuments: [] };
    expect(
      routeTarget(scope, {
        ...ready,
        sessions: [empty],
        worlds: [{ ...ready.worlds[0]!, session: empty }],
      }).kind,
    ).toBe("pick");
  });
});
