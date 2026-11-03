// RAM-1 probe agent: one prompt streams like a long real Pea turn (a text chunk every 100 ms and a
// tool call with a ~20 KB result every 6 s, for RAM1_SECONDS, default 240), so a browser's memory
// across one thread run can be measured without Revit or a model. Only what the probe needs.
import { Readable, Writable } from "node:stream";
import { AgentSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

const seconds = Number(process.env.RAM1_SECONDS ?? 240);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const result = JSON.stringify(
  Array.from({ length: 200 }, (_, i) => ({ id: 14577391 + i, name: `MUAS-1 part ${i}`, flow: 900 + i, note: "x".repeat(40) })),
);
let cancelled = false;
// The host refuses a harness without a journal-safe default mode; same shape as fake-acp-agent.mjs.
const session = {
  modes: {
    availableModes: ["default", "read-only", "auto", "bypassPermissions"].map((id) => ({ id, name: id })),
    currentModeId: "default",
  },
  models: { availableModels: [{ modelId: "m1", name: "m1" }], currentModelId: "m1" },
};
new AgentSideConnection(
  (conn) => ({
    initialize: async () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {} }, promptCapabilities: {} },
      authMethods: [],
    }),
    authenticate: () => {},
    async newSession() {
      await conn.extNotification("_auth/status_update", { authStatus: { kind: "account" } });
      return { sessionId: "ram1-session", ...session };
    },
    resumeSession: () => session,
    setSessionMode: () => ({}),
    cancel: () => {
      cancelled = true;
    },
    async prompt({ sessionId }) {
      cancelled = false;
      const end = Date.now() + seconds * 1000;
      for (let n = 0; Date.now() < end && !cancelled; n++) {
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `word${n} ` } },
        });
        if (n % 60 === 0) {
          const toolCallId = `tool-${n}`;
          await conn.sessionUpdate({
            sessionId,
            update: { sessionUpdate: "tool_call", toolCallId, title: `pe_read ducts ${n}`, kind: "read", status: "in_progress", rawInput: { n } },
          });
          await conn.sessionUpdate({
            sessionId,
            update: { sessionUpdate: "tool_call_update", toolCallId, status: "completed", rawOutput: result, content: [{ type: "content", content: { type: "text", text: result } }] },
          });
        }
        await sleep(100);
      }
      return { stopReason: cancelled ? "cancelled" : "end_turn" };
    },
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
