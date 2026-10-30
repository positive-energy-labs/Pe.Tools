// Attachments cross the wire: Send passes them, the client posts them, and the user turn draws them.
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  harnessEventSchema,
  promptRequestSchema,
  type PromptAttachment,
} from "@pe/agent-contracts";

import { chatGraph, type ChatRouteDeps } from "./graph";
import { createGraphMount } from "#/shell/mount";
import { emptyPrompt } from "#/workbench/prompt";
import { emptyChatState, selectMessages } from "@pe/agent-contracts/chat-state";
import { harnessClient, type PromptRequest } from "#/workbench/provider/harness-client";

const png: PromptAttachment = { name: "riser.png", mimeType: "image/png", size: 4, data: "iVBO" };
const csv: PromptAttachment = {
  name: "sizes.csv",
  mimeType: "text/csv",
  size: 7,
  text: "a,b\n1,2",
};
const owners: ReturnType<typeof createGraphMount>[] = [];
function sendControl(deps: ChatRouteDeps) {
  const graph = chatGraph(() => deps);
  const owner = createGraphMount(graph, {
    sources: Object.fromEntries(
      Object.keys(graph.readings).map((id) => [id, { kind: "use" as const, open: () => {} }]),
    ),
    initialPage: { thread: deps.thread },
    getSnapshot: () => ({ target: { kind: "host" }, work: null }),
    subscribe: () => () => {},
    subscribeAcceptedDeltas: () => () => {},
    write: async () => {
      throw Error("Chat never writes route Work");
    },
    binding: (_id, row) => ({ subject: null, args: row ?? {} }),
  });
  owners.push(owner as ReturnType<typeof createGraphMount>);
  return {
    ready: (input: unknown) => owner.control("send", input).refusal,
    run: (input: unknown) => owner.control("send", input).run(),
    owner,
  };
}
afterEach(() => {
  owners.splice(0).forEach((owner) => owner.dispose());
  vi.unstubAllGlobals();
});

it("a sent draft with attachments reaches send, and attachments alone are a prompt", async () => {
  const sent: PromptRequest[] = [];
  const send = sendControl({
    thread: "t",
    ready: true,
    send: async (input) => void sent.push(input),
    promptCapabilities: { image: true, embeddedContext: true },
    providerName: "Claude Code",
  });
  const draft = { text: "", attachments: [png, csv] } as never;
  expect(send.ready(draft)).toBeNull();
  await send.run(draft);
  expect(sent).toEqual([{ delivery: "steer", text: "", attachments: [png, csv] }]);
  expect(send.ready({ text: " ", attachments: [] } as never)).toBe(
    "Enter a prompt, attachment or mention",
  );
});

it("a draft holding only mentions is a prompt: the composer, the route and the host agree", () => {
  const send = sendControl({ thread: "t", ready: true, send: async () => {} });
  const mention = {
    key: "skill:@product/skills/execute",
    kind: "skill",
    title: "execute",
    takenAt: "2026-10-12T12:00:00.000Z",
    facts: {},
  };
  const draft = { text: " ", attachments: [], mentions: [mention] };
  expect(emptyPrompt(draft)).toBeNull();
  expect(send.ready(draft as never)).toBeNull();
  expect(promptRequestSchema.safeParse({ id: crypto.randomUUID(), ...draft }).success).toBe(true);
  expect(emptyPrompt({ ...draft, mentions: [] })).toBe("Enter a prompt, attachment or mention");
});

it("Send refuses a kind the thread's harness does not read, before the request", () => {
  const send = sendControl({
    thread: "t",
    ready: true,
    send: async () => {},
    promptCapabilities: { image: false, embeddedContext: true },
    providerName: "Codex",
  });
  expect(send.ready({ text: "look", attachments: [png, csv] } as never)).toBe(
    "Codex cannot read attached images: remove riser.png to send",
  );
});

it("the client posts the attachments in the prompt body the host parses", async () => {
  const bodies: unknown[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    if (typeof init.body !== "string") throw Error("Expected a JSON body");
    bodies.push(JSON.parse(init.body));
    return Response.json({ turnId: "t1", state: "running" });
  });
  await harnessClient("http://host").prompt("t", { text: "look", attachments: [png, csv] });
  expect(promptRequestSchema.parse(bodies[0])).toEqual({
    id: expect.any(String),
    delivery: "steer",
    text: "look",
    attachments: [png, csv],
  });
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

it("chat mode is a Page verb and never enters Work's inverse journal", async () => {
  const { owner } = sendControl({ thread: "t", ready: true });
  expect(await owner.control("world").run()).toMatchObject({ state: "done", kind: "page" });
  expect(owner.view.read().page.mode).toBe("world");
  expect(await owner.restore("undo")).toBeNull();
  expect(owner.view.read().page.mode).toBe("world");
});

it("a composer cannot send to a thread that changed after its Page binding", async () => {
  const sent = vi.fn(async () => {});
  const deps: ChatRouteDeps = { thread: "first", ready: true, send: sent };
  const send = sendControl(deps);
  deps.thread = "second";
  expect(send.ready({ text: "old draft" })).toBe("Thread state is loading");
  expect(await send.run({ text: "old draft" })).toMatchObject({ state: "refused" });
  expect(sent).not.toHaveBeenCalled();
});
