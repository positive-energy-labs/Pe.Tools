import { expect, test } from "vite-plus/test";
import { createWorkbenchState } from "@pe/agent-contracts";
import { workbenchToThreadMessages } from "./aui-adapter.ts";

test("tool calls render where the model emitted them, not all at the end", () => {
  const state = createWorkbenchState();
  state.transcript.messages = [
    {
      id: "a1",
      role: "assistant",
      status: "complete",
      parts: [
        { kind: "text", text: "before" },
        { kind: "tool_call_ref", toolCallId: "t1" },
        { kind: "text", text: "after" },
      ],
    },
  ];
  state.tools.calls = [{ id: "t1", title: "grep", parentMessageId: "a1" }];

  const [message] = workbenchToThreadMessages(state);
  if (!Array.isArray(message!.content)) throw new Error("expected structured message content");
  const kinds = message!.content.map((p) => p.type);
  expect(kinds).toEqual(["text", "tool-call", "text"]);
});
