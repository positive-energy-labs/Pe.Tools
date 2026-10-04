// A fake ACP agent for harness-threads.test.ts: echoes the prompt, emits one tool_call, asks one
// permission when the prompt says "permission", hangs until cancel on "hang", lingers on "slow", and
// names the session on "title", and switches its own mode on "mode". `FAKE_ACP_SHAPE=config` answers only `configOptions` for the model;
// otherwise only the unstable `models` state, so `setModel` takes `session/set_model`.
// `session/load` replays one old update, as a real adapter replays history.
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";

const shape = process.env.FAKE_ACP_SHAPE === "config" ? "config" : "models";
const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "m1",
    options: [
      { value: "m1", name: "M1" },
      { value: "m2", name: "M2" },
    ],
  },
];
const session = (sessionId) => ({
  sessionId,
  modes: {
    availableModes: [
      { id: "default", name: "Default" },
      { id: "plan", name: "Plan" },
    ],
    currentModeId: "default",
  },
  ...(shape === "config"
    ? { configOptions }
    : {
        models: {
          availableModels: [
            { modelId: "m1", name: "M1" },
            { modelId: "m2", name: "M2" },
          ],
          currentModelId: "m1",
        },
      }),
});
let cancelled = () => {};

new AgentSideConnection(
  (conn) => ({
    initialize: () => ({
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      authMethods: [],
    }),
    authenticate: () => {},
    newSession: () => session("fake-session"),
    async loadSession({ sessionId }) {
      await conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "old replay" },
        },
      });
      return session(sessionId);
    },
    setSessionConfigOption: ({ value }) => {
      if (shape !== "config") throw new Error("no config options");
      if (value !== "m1" && value !== "m2") throw RequestError.invalidParams({ value });
      return { configOptions };
    },
    extMethod: (method) => {
      if (method !== "session/set_model" || shape === "config") throw new Error(`no ${method}`);
      return {};
    },
    setSessionMode: () => ({}),
    cancel: () => cancelled(),
    async prompt({ sessionId, prompt }) {
      const text = prompt.map((block) => block.text ?? "").join("");
      const say = (chunk) =>
        conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } },
        });
      await say(`echo: ${text}`);
      if (text === "hang")
        return new Promise((resolve) => (cancelled = () => resolve({ stopReason: "cancelled" })));
      if (text === "mode") {
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "current_mode_update", currentModeId: "plan" },
        });
        return { stopReason: "end_turn" };
      }
      if (text === "title") {
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "session_info_update", title: "Fake title" },
        });
        return { stopReason: "end_turn" };
      }
      const toolCall = {
        toolCallId: `t-${text}`,
        title: "fake tool",
        kind: "edit",
        status: "pending",
      };
      await conn.sessionUpdate({ sessionId, update: { sessionUpdate: "tool_call", ...toolCall } });
      if (text.includes("permission")) {
        const answer = await conn.requestPermission({
          sessionId,
          toolCall,
          options: [
            { optionId: "yes", name: "Allow", kind: "allow_once" },
            { optionId: "no", name: "Reject", kind: "reject_once" },
          ],
        });
        if (answer.outcome.outcome === "cancelled") return { stopReason: "cancelled" };
        await say(`chose ${answer.outcome.optionId}`);
      }
      if (text === "slow") await new Promise((resolve) => setTimeout(resolve, 300));
      return { stopReason: "end_turn" };
    },
  }),
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
