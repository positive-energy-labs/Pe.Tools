import { EventType } from "@ag-ui/core";
import { createTool } from "@mastra/core/tools";
import { expect, test } from "vite-plus/test";
import {
  createRuntimeToolCatalog,
  createRuntimeToolProfile,
  MastraHarnessToRuntimeEvents,
  RuntimeAcpClient,
  RuntimeToAcpEvents,
  RuntimeToAgUiEvents,
} from "../src/index.ts";

test("runtime tool profiles carry Mastra tools, metadata, and optional command factories", () => {
  const catalog = createRuntimeToolCatalog({ custom_reader: { kind: "read" } });
  const customReader = createTool({
    id: "custom_reader",
    description: "Read",
    execute: async () => ({ ok: true }),
  });
  const tools = { [customReader.id]: customReader };
  const profile = createRuntimeToolProfile({
    id: "custom",
    tools,
    catalog,
    commands: { createSubCommands: () => ({ custom: { name: "custom" } }) },
  });

  expect(profile.tools).toBe(tools);
  expect(profile.catalog).toBe(catalog);
  expect(profile.commands?.createSubCommands?.()).toEqual({ custom: { name: "custom" } });
});

test("MastraHarnessToRuntimeEvents enriches tool lifecycle events from a catalog", () => {
  const catalog = createRuntimeToolCatalog({
    custom_reader: {
      title: "Custom Reader",
      kind: "read",
      provenance: { source: "app", label: "test" },
    },
  });
  const translator = new MastraHarnessToRuntimeEvents({ toolCatalog: catalog });

  const [started] = translator.translate({
    type: "tool_start",
    toolCallId: "tool-1",
    toolName: "custom_reader",
    args: { path: "readme.md" },
  } as never);
  const [finished] = translator.translate({
    type: "tool_end",
    toolCallId: "tool-1",
    result: { ok: true },
    isError: false,
  } as never);

  expect(started).toMatchObject({
    type: "tool_started",
    tool: {
      name: "custom_reader",
      title: "Custom Reader",
      kind: "read",
      provenance: { source: "app", label: "test" },
    },
  });
  expect(finished).toMatchObject({
    type: "tool_finished",
    toolName: "custom_reader",
    tool: { name: "custom_reader", title: "Custom Reader", kind: "read" },
  });
});

test("RuntimeToAcpEvents prefers metadata kind and title before fallback buckets", () => {
  const mapper = new RuntimeToAcpEvents();
  const [metadataUpdate] = mapper.translate({
    type: "tool_started",
    toolCallId: "tool-2",
    toolName: "unmapped_tool",
    status: "running",
    input: { id: 1 },
    tool: { name: "unmapped_tool", title: "Mapped Tool", kind: "execute" },
  });
  const [fallbackUpdate] = new RuntimeToAcpEvents().translate({
    type: "tool_started",
    toolCallId: "tool-3",
    toolName: "execute_command",
    status: "running",
  });

  expect(metadataUpdate).toMatchObject({
    sessionUpdate: "tool_call",
    title: "Mapped Tool",
    kind: "execute",
  });
  expect(fallbackUpdate).toMatchObject({
    sessionUpdate: "tool_call",
    title: "Execute Command",
    kind: "execute",
  });
});

test("RuntimeAcpClient permission requests use metadata kind and title", async () => {
  let captured: unknown;
  const client = new RuntimeAcpClient({
    requestPermission: async (request) => {
      captured = request;
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    },
  });

  await client.requestPermission({
    sessionId: "session-1",
    toolCall: {
      toolCallId: "tool-4",
      toolName: "custom_permission_tool",
      input: { target: "x" },
      tool: { name: "custom_permission_tool", title: "Permission Tool", kind: "edit" },
    },
  });

  expect(captured).toMatchObject({
    sessionId: "session-1",
    toolCall: {
      toolCallId: "tool-4",
      title: "Permission Tool",
      kind: "edit",
      status: "pending",
      rawInput: { target: "x" },
    },
  });
});

test("RuntimeToAgUiEvents keeps tool event names stable and does not emit metadata side channels", () => {
  const mapper = new RuntimeToAgUiEvents();
  const events = [
    ...mapper.translate({
      type: "tool_started",
      toolCallId: "tool-5",
      toolName: "custom_reader",
      status: "running",
      input: { path: "readme.md" },
      tool: {
        name: "custom_reader",
        title: "Custom Reader",
        kind: "read",
        provenance: { source: "app" },
      },
    }),
    ...mapper.translate({
      type: "tool_updated",
      toolCallId: "tool-5",
      partialResult: { chunk: 1 },
    }),
    ...mapper.translate({
      type: "tool_shell_output",
      toolCallId: "tool-5",
      output: "hello",
      stream: "stdout",
    }),
    ...mapper.translate({
      type: "tool_finished",
      toolCallId: "tool-5",
      result: { ok: true },
      isError: false,
    }),
  ];

  expect(events.map((event) => event.type)).toEqual([
    EventType.TOOL_CALL_START,
    EventType.TOOL_CALL_ARGS,
    EventType.CUSTOM,
    EventType.CUSTOM,
    EventType.TOOL_CALL_END,
    EventType.TOOL_CALL_RESULT,
  ]);
  expect(
    events.filter((event) => event.type === EventType.CUSTOM).map((event) => event.name),
  ).toEqual(["runtime.tool.update", "runtime.tool.shell_output"]);
});
