import { expect, test } from "vite-plus/test";
import type { Mention } from "@pe/agent-contracts";
import type { ChatMessage, ToolCall } from "@pe/agent-contracts/chat-state";

import { EMPTY_CHAT_DRAFT } from "#/workbench/prompt";
import { referModel, threadAssets } from "./asset-reel";

const doc = {
  key: "doc:s/1",
  kind: "document",
  title: "Model A",
  facts: {},
  takenAt: "2026-10-13T00:00:00Z",
} as unknown as Mention;
const skill = { ...doc, key: "skill:x", kind: "skill", title: "x" } as unknown as Mention;
const call = (images: string[], target?: string): ToolCall => ({
  id: "c",
  title: "capture_view",
  args: {},
  images,
  target,
  status: "completed",
});

test("the reel reads a thread in order: model mentions, attachments, then captures, each under its turn", () => {
  const messages: ChatMessage[] = [
    {
      id: "u1",
      role: "user",
      running: false,
      mentions: [doc, skill],
      parts: [{ type: "text", text: "@Model A" }],
    },
    {
      id: "a1",
      role: "assistant",
      running: false,
      parts: [{ type: "tool-call", call: call(["p1", "p2"], "C:\\views\\L2") }],
    },
    {
      id: "u2",
      role: "user",
      running: false,
      parts: [
        { type: "image", image: "data:x", name: "clip.png" },
        { type: "file", name: "spec.pdf", mimeType: "application/pdf", size: 9 },
      ],
    },
  ];
  expect(threadAssets(messages).map((a) => [a.kind, a.name, a.turn, a.messageId])).toEqual([
    ["model", "Model A", 1, "u1"],
    ["capture", "L2 1", 1, "a1"],
    ["capture", "L2 2", 1, "a1"],
    ["image", "clip.png", 2, "u2"],
    ["file", "spec.pdf", 2, "u2"],
  ]);
});

test("a model re-mentions as the mention Pea received, joined once", () => {
  const once = referModel({ ...EMPTY_CHAT_DRAFT, text: "check" }, doc);
  expect(once).toMatchObject({ text: "check @Model A ", mentions: [doc] });
  expect(referModel(once, doc).mentions).toEqual([doc]);
});
