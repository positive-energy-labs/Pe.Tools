import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { emptyThreadHead } from "@pe/agent-contracts";
import { ActionJournal } from "../src/action-journal.ts";
import { admitGatewayAction } from "../src/gateway-actions.ts";
import { admitCrossing, bindControl, grantExpiry } from "../src/control.ts";
import type { RevitBridge } from "../src/bridge.ts";

const fixture = vi.hoisted(() => ({ session: {} as Record<string, any> }));
vi.mock("../src/sdk-session.ts", () => ({ resolveSdkSession: async () => fixture.session }));
const lifetime = { session: "S", openId: "granted" };
const caller = { kind: "pea", context: "test", thread: "t" } as const;
afterEach(() => bindControl({ heads: null, acquired: () => null, acquiredSession: () => null }));

test("K9 refuses an ungranted sibling before script preparation or dispatch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pe-k9-"));
  const journal = new ActionJournal(join(root, "actions.json"));
  bindControl({
    heads: () => ({
      ...emptyThreadHead,
      revision: 1,
      defaultTarget: { kind: "open", ref: lifetime },
      grant: {
        lifetime,
        grantedAt: new Date().toISOString(),
        grantedVia: "local",
        expiresAt: grantExpiry(Date.now()),
        revoked: null,
      },
    }),
  });
  fixture.session = {
    sessionId: "S",
    connected: true,
    state: {
      openDocuments: [
        { openId: "granted", isFamilyDocument: false },
        { openId: "other", isFamilyDocument: false },
      ],
    },
  };
  const invoke = vi.fn(() =>
    Effect.succeed({
      value: {
        operations: [
          {
            key: "scripting.execute",
            intent: "Mutate",
            needs: "document",
            requestSchemaJson: JSON.stringify({ type: "object" }),
          },
        ],
      },
      target: null,
    }),
  );
  try {
    await admitGatewayAction(
      {
        id: "k9",
        kind: "operation",
        key: "scripting.execute",
        destination: { kind: "document", ref: lifetime },
        input: {},
        bases: {},
      },
      { caller, basis: admitCrossing(caller, { kind: "document", ref: lifetime }, "/actions") },
      journal,
      { invoke } as unknown as RevitBridge["Service"],
      async () => undefined,
    );
    const row = await journal.wait("k9");
    expect(row.state).toBe("failed");
    expect(row.steps).toEqual([]);
    expect(JSON.stringify(row)).toContain("script.ungranted-documents");
    expect(invoke.mock.calls).toHaveLength(1); // Catalog read only; no script dispatch.
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
