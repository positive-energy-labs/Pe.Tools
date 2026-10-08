// A fake ACP agent for harness-threads.test.ts: echoes the prompt, emits one tool_call, asks one
// permission when the prompt says "permission", asks one form question on "question", hangs until
// cancel on "hang" (and with no update at all on "silent"), lingers on "slow", names the session on
// "title", and echoes its env on "env". `FAKE_ACP_SHAPE=config` answers `configOptions` (model, an effort select, a fast boolean);
// otherwise only the unstable `models` state, so `setModel` takes `session/set_model`. Auth as the
// real adapters report it (2026-10-08): `_auth/status_update` before the session answers, kind from
// `FAKE_ACP_AUTH` (`account` by default, `none`), and `required` refuses `session/new`. `session/resume` picks a stored
// session up with no replay and refuses the id "lost"; `session/fork` answers a new id.
import { Readable, Writable } from "node:stream";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";

const shape = process.env.FAKE_ACP_SHAPE === "config" ? "config" : "models";
const pinnedModel =
  process.env.ANTHROPIC_MODEL ??
  (process.env.CODEX_CONFIG ? JSON.parse(process.env.CODEX_CONFIG).model : undefined);
const nativeModels = process.env.MODEL_PROVIDER
  ? ["gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.2-codex"]
  : ["m1", "m2"];
const currentModel =
  pinnedModel ??
  (process.env.MODEL_PROVIDER ? process.env.FAKE_ACP_NATIVE_CURRENT : undefined) ??
  nativeModels[0];
const configOptions = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: currentModel,
    options: [
      ...(!nativeModels.includes(currentModel)
        ? [{ value: currentModel, name: currentModel }]
        : []),
      ...nativeModels.map((value) => ({ value, name: value })),
    ],
  },
  {
    id: "mode",
    name: "Mode",
    category: "mode",
    type: "select",
    currentValue: "default",
    options: [{ value: "default", name: "Default" }],
  },
  {
    id: "effort",
    name: "Effort",
    category: "thought_level",
    type: "select",
    currentValue: "low",
    options: [
      { value: "low", name: "Low" },
      { value: "high", name: "High" },
    ],
  },
  { id: "fast", name: "Fast", category: "model_config", type: "boolean", currentValue: false },
];
let currentMode = "default";
const session = (sessionId) => ({
  sessionId,
  modes: {
    availableModes: [
      { id: "default", name: "Default" },
      { id: "auto", name: "Auto" },
      { id: "bypassPermissions", name: "Bypass permissions" },
    ],
    currentModeId: currentMode,
  },
  ...(shape === "config" ? { configOptions } : {}),
  models: {
    availableModels: nativeModels.map((modelId) => ({
      modelId: shape === "config" ? `${modelId}[low]` : modelId,
      name: modelId,
    })),
    currentModelId: currentModel,
  },
});
let cancelled = () => {};
async function gate(step) {
  if (!process.env.FAKE_ACP_GATE) return;
  const path = join(process.env.FAKE_ACP_GATE, step);
  if (existsSync(path)) writeFileSync(`${path}.active`, "waiting");
  while (existsSync(path)) await new Promise((resolve) => setTimeout(resolve, 10));
}

new AgentSideConnection(
  (conn) => ({
    initialize: async () => {
      await gate("connect");
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true, sessionCapabilities: { resume: {}, fork: {} } },
        authMethods: [],
      };
    },
    authenticate: () => {},
    async newSession() {
      const auth = process.env.FAKE_ACP_AUTH ?? "account";
      if (auth === "required") throw RequestError.authRequired();
      await conn.extNotification("_auth/status_update", {
        authStatus:
          auth === "none" ? { kind: "none", label: "Not logged in" } : { kind: "account" },
      });
      return session("fake-session");
    },
    resumeSession({ sessionId }) {
      if (sessionId === "lost") throw RequestError.invalidParams({ sessionId });
      const { sessionId: _, ...rest } = session(sessionId);
      return rest;
    },
    unstable_forkSession: ({ sessionId }) => session(`${sessionId}-fork`),
    setSessionConfigOption: async ({ configId, value }) => {
      await gate("config");
      if (shape !== "config") throw new Error("no config options");
      const option = configOptions.find((o) => o.id === configId);
      const valid =
        option?.type === "boolean"
          ? typeof value === "boolean"
          : option?.options.some((o) => o.value === value);
      if (!valid) throw RequestError.invalidParams({ configId, value });
      option.currentValue = value;
      return { configOptions };
    },
    extMethod: (method) => {
      if (method !== "session/set_model" || shape === "config") throw new Error(`no ${method}`);
      return {};
    },
    setSessionMode: ({ modeId }) => {
      currentMode = modeId;
      return {};
    },
    cancel: () => cancelled(),
    async prompt({ sessionId, prompt }) {
      const text = prompt.map((block) => block.text ?? "").join("");
      const say = (chunk) =>
        conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } },
        });
      await say(`echo: ${text}`);
      if (text === "pid") {
        await say(`PID=${process.pid}`);
        return { stopReason: "end_turn" };
      }
      if (text === "hang")
        return new Promise((resolve) => (cancelled = () => resolve({ stopReason: "cancelled" })));
      if (text === "question") {
        const answer = await conn.createElicitation({
          sessionId,
          mode: "form",
          message: "Which one?",
          requestedSchema: {
            type: "object",
            properties: {
              pick: {
                type: "string",
                title: "Pick",
                oneOf: [
                  { const: "a", title: "A" },
                  { const: "b", title: "B" },
                ],
              },
            },
            required: ["pick"],
          },
        });
        await say(
          answer.action === "accept"
            ? `answered ${answer.content?.pick}`
            : `question ${answer.action}`,
        );
        return { stopReason: "end_turn" };
      }
      if (text === "env") {
        for (const name of [
          "CODEX_CONFIG",
          "MODEL_PROVIDER",
          "PEA_ENDPOINT_API_KEY",
          "ANTHROPIC_BASE_URL",
          "ANTHROPIC_AUTH_TOKEN",
        ])
          await say(`${name}=${process.env[name] ?? ""}`);
        await say(`PATH=${process.env.PATH ?? process.env.Path ?? ""}`);
        await say(`MODE=${currentMode}`);
        return { stopReason: "end_turn" };
      }
      if (text === "silent")
        return new Promise((resolve) => (cancelled = () => resolve({ stopReason: "cancelled" })));
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
