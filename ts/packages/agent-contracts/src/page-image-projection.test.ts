import { expect, it } from "vite-plus/test";
import { emptyChatState, selectToolCalls } from "./chat-state.ts";
import type { HarnessEvent } from "./harness-thread.ts";
const url = `http://host/captures/${"a".repeat(64)}.png`;
const metadata = {
  ok: true,
  kind: "page",
  key: "page:@pages/flow",
  capture: { mimeType: "image/png", url, sha256: "a".repeat(64), width: 1000, height: 700 },
};
const clipped = `${"a".repeat(4096)}… [108276 characters not kept]`;
const text = { type: "text", text: JSON.stringify(metadata) };
const image = { type: "image", mimeType: "image/png", data: clipped };
const fold = (body: object) =>
  selectToolCalls({
    ...emptyChatState(),
    events: [
      {
        kind: "update",
        seq: 1,
        at: "2026-10-14T00:00:00Z",
        turnId: "turn",
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId: "page",
          status: "completed",
          ...body,
        },
      },
    ] as HarnessEvent[],
  })[0]!;
it.each([
  {
    rawOutput: [
      text,
      { type: "image", source: { type: "base64", media_type: "image/png", data: clipped } },
    ],
  },
  { rawOutput: { result: { content: [text, image] } } },
  { content: [text, image].map((content) => ({ type: "content", content })) },
])("replays one durable Page image from the real harness result shapes", (body) => {
  const call = fold(body);
  expect(call.images).toEqual([url]);
  expect(fold(JSON.parse(JSON.stringify(body))).images).toEqual([url]);
});
it("never projects a clipped base64 image as if it were valid PNG", () => {
  expect(fold({ rawOutput: [image] }).images).toEqual([]);
  expect(fold({ rawOutput: [{ ...image, data: "a".repeat(4096) + "!aaa" }] }).images).toEqual([]);
});
