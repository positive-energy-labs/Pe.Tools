// A fake ACP agent for harness-threads.test.ts: echoes the prompt, emits one tool_call, asks one
// permission when the prompt says "permission", asks one form question on "question", hangs until
// cancel on "hang" (and with no update at all on "silent"), ignores cancel on "stubborn" (saying
// "ignoring cancel"), lingers on "slow", names the session on
// "title", and echoes its env on "env". `FAKE_ACP_SHAPE=config` answers `configOptions` (model, an effort select, a fast boolean);
// otherwise only the unstable `models` state, so `setModel` takes `session/set_model`. Auth as the
// real adapters report it (2026-10-08): `_auth/status_update` before the session answers, kind from
// `FAKE_ACP_AUTH` (`account` by default, `none`), and `required` refuses `session/new`. `session/resume` picks a stored
// session up with no replay and refuses the id "lost"; `session/fork` answers a new id. It reads
// images and embedded context unless `FAKE_ACP_PROMPT=none`, and says `blocks: <json>` for every
// non-text prompt block (a linked file's bytes read back from its path), then `order: <types>` when
// a `pe://` mention resource rode along.
import { Readable, Writable } from "node:stream";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  RequestError,
} from "@agentclientprotocol/sdk";

if (process.env.FAKE_ACP_LOG)
  appendFileSync(process.env.FAKE_ACP_LOG, `${JSON.stringify({ pid: process.pid })}\n`);

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
let toolEnv = {};
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
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { resume: {}, fork: {} },
          promptCapabilities:
            process.env.FAKE_ACP_PROMPT === "none" ? {} : { image: true, embeddedContext: true },
        },
        authMethods: [],
      };
    },
    authenticate: () => {},
    async newSession({ mcpServers }) {
      toolEnv = Object.fromEntries(
        (mcpServers.find((server) => server.name === "pea")?.env ?? []).map(({ name, value }) => [
          name,
          value,
        ]),
      );
      const auth = process.env.FAKE_ACP_AUTH ?? "account";
      if (auth === "required") throw RequestError.authRequired();
      const report = () =>
        conn.extNotification("_auth/status_update", {
          authStatus:
            auth === "none" ? { kind: "none", label: "Not logged in" } : { kind: "account" },
        });
      if (process.env.FAKE_ACP_AUTH_LATE) setTimeout(report, 20);
      else await report();
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
      if (!process.env.FAKE_ACP_CLAMP) option.currentValue = value;
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
      if (text === "auth-expired") throw RequestError.authRequired();
      if (text === "credit-refusal")
        throw new Error(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              message: "Your credit balance is too low to access the Anthropic API.",
            },
          }),
        );
      const say = (chunk) =>
        conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: chunk } },
        });
      await say(`echo: ${text}`);
      if (text === "route-cutover-open") {
        // Browser acceptance substitutes inference, not identity, route delivery, lease or render ack.
        const base = toolEnv.PE_TOOLS_HOST_BASE_URL;
        if (!base || !process.env.PE_CONTEXT)
          throw Error("route cutover needs a real host-minted Pea context");
        const headers = {
          "content-type": "application/json",
          "x-pe-context": process.env.PE_CONTEXT,
        };
        const request = async (path, body) => {
          const response = await fetch(new URL(path, base), {
            method: body ? "POST" : "GET",
            headers,
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000),
          });
          return { status: response.status, value: await response.json() };
        };
        const scope = await request("/pe/scope/self");
        if (scope.status !== 200 || !scope.value.thread) throw Error("missing own conversation");
        const opened = await request("/pe/route-view/families/open", {
          thread: scope.value.thread,
          link: "/families",
        });
        if (opened.status !== 200) throw Error(`open refused: ${JSON.stringify(opened.value)}`);
        const end = Date.now() + 12000;
        let mounted;
        while (Date.now() < end) {
          const read = await request(
            `/pe/route-view/families?thread=${encodeURIComponent(scope.value.thread)}`,
          );
          if (read.status === 200 && read.value.openCommandId === opened.value.commandId) {
            mounted = read.value;
            break;
          }
          await new Promise((done) => setTimeout(done, 100));
        }
        if (!mounted) throw Error("explicit open did not acquire its own rendered lease");
        const applied = await request("/pe/route-view/families/set", {
          thread: scope.value.thread,
          instance: mounted.instance,
          revision: mounted.revision,
          patch: { query: "" },
        });
        if (applied.status !== 200 || applied.value.outcome !== "rendered")
          throw Error(`render ack refused: ${JSON.stringify(applied.value)}`);
        await say(`route-cutover-rendered ${opened.value.commandId}`);
        return { stopReason: "end_turn" };
      }
      const blocks = prompt.flatMap((b) =>
        b.type === "image"
          ? [{ type: b.type, mimeType: b.mimeType, data: b.data }]
          : b.type === "resource"
            ? [{ type: b.type, ...b.resource }]
            : b.type === "resource_link"
              ? [
                  {
                    type: b.type,
                    name: b.name,
                    mimeType: b.mimeType,
                    size: b.size,
                    bytes: readFileSync(fileURLToPath(b.uri)).toString("base64"),
                  },
                ]
              : [],
      );
      if (blocks.length) await say(`blocks: ${JSON.stringify(blocks)}`);
      // Mentions must follow the text, so a prompt carrying one says its block order.
      if (prompt.some((b) => b.type === "resource" && b.resource.uri.startsWith("pe://")))
        await say(`order: ${prompt.map((b) => b.type).join(",")}`);
      if (text === "settings") {
        configOptions[0].id = "live-model";
        configOptions[0].currentValue = "m2";
        configOptions[2].currentValue = "high";
        configOptions[3].currentValue = true;
        await conn.sessionUpdate({
          sessionId,
          update: { sessionUpdate: "config_option_update", configOptions },
        });
        return new Promise((resolve) => (cancelled = () => resolve({ stopReason: "cancelled" })));
      }
      if (text === "pid") {
        await say(`PID=${process.pid}`);
        return { stopReason: "end_turn" };
      }
      if (text === "huge") {
        // One enormous tool result: a long text and a wide structure of small values.
        await conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t-huge",
            status: "completed",
            content: [{ type: "content", content: { type: "text", text: "x".repeat(2_000_000) } }],
          },
        });
        await conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "t-wide",
            status: "completed",
            rawOutput: { rows: Array.from({ length: 30_000 }, (_, i) => ({ i })) },
          },
        });
        return { stopReason: "end_turn" };
      }
      if (text === "hang")
        return new Promise((resolve) => (cancelled = () => resolve({ stopReason: "cancelled" })));
      if (text === "stubborn")
        return new Promise(() => (cancelled = () => void say("ignoring cancel")));
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
          "OPENAI_API_KEY",
          "ANTHROPIC_API_KEY",
          "CLAUDE_CODE_OAUTH_TOKEN",
          "ANTHROPIC_BASE_URL",
          "ANTHROPIC_AUTH_TOKEN",
          "PYTHONIOENCODING",
        ])
          await say(`${name}=${process.env[name] ?? ""}`);
        await say(`PATH=${process.env.PATH ?? process.env.Path ?? ""}`);
        await say(`MODE=${currentMode}`);
        return { stopReason: "end_turn" };
      }
      if (text === "silent")
        return new Promise((resolve) => (cancelled = () => resolve({ stopReason: "cancelled" })));
      if (text === "usage")
        return {
          stopReason: "end_turn",
          usage: {
            totalTokens: 15,
            inputTokens: 10,
            outputTokens: 5,
            cachedReadTokens: 4,
            cachedWriteTokens: null,
          },
        };
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
