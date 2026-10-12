// Attachments cross the wire: Send passes them, the client posts them, and the user turn draws them.
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  harnessEventSchema,
  promptRequestSchema,
  type PromptAttachment,
} from "@pe/agent-contracts";

import { chatManifest, type PromptInput } from "#/chat/manifest";
import { emptyChatState, selectMessages } from "#/workbench/chat-state";
import { harnessClient } from "#/workbench/provider/harness-client";

const png: PromptAttachment = { name: "riser.png", mimeType: "image/png", size: 4, data: "iVBO" };
const csv: PromptAttachment = {
  name: "sizes.csv",
  mimeType: "text/csv",
  size: 7,
  text: "a,b\n1,2",
};
// No head or inventory read yet: nothing is closed, so Send reasons only about the draft.
const ctx = { readings: { head: { state: "absent" }, inventory: { state: "absent" } } } as never;

afterEach(() => vi.unstubAllGlobals());

it("a sent draft with attachments reaches send, and attachments alone are a prompt", async () => {
  const sent: PromptInput[] = [];
  const send = chatManifest({
    thread: "t",
    ready: true,
    send: async (input) => void sent.push(input),
    promptCapabilities: { image: true, embeddedContext: true },
    providerName: "Claude Code",
  }).actions!.send;
  const draft = { text: "", attachments: [png, csv] } as never;
  expect(send.ready(ctx, draft)).toBeNull();
  await send.run(ctx, draft);
  expect(sent).toEqual([{ text: "", attachments: [png, csv] }]);
  expect(send.ready(ctx, { text: " ", attachments: [] } as never)).toBe(
    "Enter a prompt or attachment",
  );
});

it("Send refuses a kind the thread's harness does not read, before the request", () => {
  const send = chatManifest({
    thread: "t",
    ready: true,
    send: async () => {},
    promptCapabilities: { image: false, embeddedContext: true },
    providerName: "Codex",
  }).actions!.send;
  expect(send.ready(ctx, { text: "look", attachments: [png, csv] } as never)).toBe(
    "Codex cannot read attached images: remove riser.png to send",
  );
});

it("the client posts the attachments in the prompt body the host parses", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return Response.json({ turnId: "t1" });
  });
  await harnessClient("http://host").prompt("t", "look", [png, csv]);
  expect(promptRequestSchema.parse(bodies[0])).toEqual({ text: "look", attachments: [png, csv] });
});

it("the user turn draws a prompt event's image as a thumbnail and its text file as a chip", () => {
  const prompt = harnessEventSchema.parse({
    seq: 1,
    at: "2026-10-12T12:00:00.000Z",
    kind: "prompt",
    turnId: "t1",
    text: "look",
    attachments: [png, csv],
  });
  const [user] = selectMessages({ ...emptyChatState(), events: [prompt] });
  expect(user?.parts).toEqual([
    { type: "text", text: "look" },
    { type: "image", image: "data:image/png;base64,iVBO", name: "riser.png" },
    { type: "file", name: "sizes.csv", mimeType: "text/csv", size: 7 },
  ]);
});
