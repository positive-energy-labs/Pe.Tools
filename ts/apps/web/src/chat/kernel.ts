import { z } from "zod";
import type { BodyBindings } from "../../../../packages/agent-contracts/src/route-kernel-bodies.ts";
import {
  identityCodecs,
  jsonCodec,
} from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";
import {
  chatData,
  chatSchemas as schemas,
  sendReadiness,
  threadIdentity,
  threadName,
  type ChatRouteDeps,
} from "./graph.ts";
import { chatSeeds } from "./graph-seeds.ts";
import { chatSeedChoices } from "./seed-choices.ts";

const axes = {
  subject: "None",
  touches: ["Metadata"],
  effect: "Read",
  cost: "Cheap",
  cardinality: "One",
} as const;
export const entries = Object.fromEntries(
  Object.keys(chatData.readings).map((key) => [
    key,
    { input: z.unknown(), output: z.unknown(), axes },
  ]),
);
const source = { module: "chat/kernel.ts", export: "module" };
export function createChatModule(deps: () => ChatRouteDeps) {
  const seed = <const K extends keyof typeof chatSeedChoices>(name: K) => ({
    slot: `seeds.${name}.load` as const,
    kind: "seed" as const,
    source,
    run: () => ({
      ...chatSeeds[name]!,
      page: { ...chatSeeds[name]!.page, thread: threadIdentity(name) },
    }),
  });
  const bodies = {
    threadsPick: {
      slot: "fields.thread.picker.options",
      kind: "picker",
      source,
      run: (reading) =>
        reading.current && Array.isArray(reading.value)
          ? reading.value.map((t: { id: string; title?: string }) => ({
              id: threadIdentity(t.id)!,
              label: t.title || "Untitled thread",
            }))
          : [],
    },
    transcriptArgs: {
      slot: "readings.transcript.args",
      kind: "args",
      source,
      run: (ctx) => threadName(ctx.page.thread),
    },
    headArgs: {
      slot: "readings.head.args",
      kind: "args",
      source,
      run: (ctx) => threadName(ctx.page.thread),
    },
    send: {
      slot: "verbs.send.intent",
      kind: "intent",
      source,
      run: (ctx, prompt) => ({ thread: threadName(ctx.page.thread), prompt }),
    },
    stop: {
      slot: "verbs.stop.intent",
      kind: "intent",
      source,
      run: (ctx) => ({ thread: threadName(ctx.page.thread) }),
    },
    fork: {
      slot: "verbs.fork.intent",
      kind: "intent",
      source,
      run: (ctx) => ({ thread: threadName(ctx.page.thread) }),
    },
    sendReady: {
      slot: "verbs.send.ready",
      kind: "ready",
      source,
      run: (ctx, input) => sendReadiness(deps(), ctx.page.thread, ctx.readings, input) ?? true,
    },
    stopReady: {
      slot: "verbs.stop.ready",
      kind: "ready",
      source,
      run: () => (!deps().cancel || !deps().thread ? "Chat is not ready" : true),
    },
    forkReady: {
      slot: "verbs.fork.ready",
      kind: "ready",
      source,
      run: () =>
        !deps().forkThread
          ? "Chat is not ready"
          : !deps().thread
            ? "No thread to fork yet"
            : deps().running
              ? "Fork after the running turn ends"
              : true,
    },
    threadsMode: {
      slot: "verbs.threads.patch",
      kind: "page",
      source,
      run: () => ({ mode: "threads" as const }),
    },
    worldMode: {
      slot: "verbs.world.patch",
      kind: "page",
      source,
      run: () => ({ mode: "world" as const }),
    },
    threadsBody: { slot: "panes.threads.body", kind: "pane", source, run: () => null },
    chatBody: { slot: "panes.chat.body", kind: "pane", source, run: () => null },
    "seed-send": seed("send"),
    "seed-new": seed("new"),
    "seed-diagram": seed("diagram"),
    "seed-attach": seed("attach"),
    "seed-skill": seed("skill"),
    "seed-mention": seed("mention"),
    "seed-closed": seed("closed"),
    "seed-granted": seed("granted"),
    "seed-ask": seed("ask"),
    "seed-stop": seed("stop"),
  } satisfies BodyBindings<typeof chatData, typeof schemas, typeof entries>;
  return {
    data: chatData,
    schemas,
    entries,
    bodies,
    identities: { local: identityCodecs.local },
    codecs: {
      thread: {
        encode: (id: z.output<typeof schemas.thread>) => threadName(id),
        decode: (text: string) => ({ ok: true as const, value: threadIdentity(text) }),
      },
      mode: {
        encode: String,
        decode: (text: string) => {
          const parsed = schemas.mode.safeParse(text);
          return parsed.success
            ? { ok: true as const, value: parsed.data }
            : { ok: false as const, reason: "Invalid chat mode" };
        },
      },
      autoApprove: jsonCodec(schemas.autoApprove),
    },
  };
}
export const module = createChatModule(() => ({ thread: "" }));
