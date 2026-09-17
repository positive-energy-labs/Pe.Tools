import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createDeterministicRuntime } from "../src/testing.ts";
import { readThreadState } from "../src/thread-state.ts";

// 1x1 transparent PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Wire proof for chat attachments: the thread body a reload fetches still carries a sent
 * message's files. Binary files come back as `file` parts; a text file comes back inlined as
 * `[File: name]` plus a fence (Mastra's `createMessageInput`), decoded from its data URL.
 */
test("a sent message's files come back in the thread body", async () => {
  const runtime = await createDeterministicRuntime({
    databasePath: join(mkdtempSync(join(tmpdir(), "pe-attach-")), "attach.db"),
    resourceId: "attach-resource",
    responses: [{ text: "seen" }],
  });
  try {
    const session = await runtime.controller.createSession({
      resourceId: runtime.resourceId,
      scope: "attach-thread",
      threadId: "attach-thread",
    });
    await session.sendMessage({
      content: "look",
      files: [
        { data: PNG, mediaType: "image/png", filename: "dot.png" },
        { data: "aGVsbG8=", mediaType: "application/pdf", filename: "spec.pdf" },
        { data: "data:text/plain;base64,aGVsbG8=", mediaType: "text/plain", filename: "notes.txt" },
      ],
    });
    // The user row is written after `sendMessage` resolves; poll the body a reload would read.
    let state = await readThreadState(runtime, session, "attach-thread");
    for (let i = 0; i < 50 && state.messages.length < 2; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      state = await readThreadState(runtime, session, "attach-thread");
    }
    const user = state.messages.find((message) => message.role !== "assistant");
    expect(user?.content.parts).toMatchObject([
      { type: "text", text: "look" },
      { type: "file", data: PNG, mimeType: "image/png", filename: "dot.png" },
      { type: "file", data: "aGVsbG8=", mimeType: "application/pdf", filename: "spec.pdf" },
      { type: "text", text: "[File: notes.txt]\n```\nhello\n```" },
    ]);
  } finally {
    await runtime.close?.();
  }
});
