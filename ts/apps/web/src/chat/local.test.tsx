// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vite-plus/test";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { z } from "zod";
import {
  builtinClosureFingerprint,
  createBuiltinRouteInventory,
} from "../../../../packages/agent-contracts/src/route-module";
import { module as captures } from "../captures/kernel";
import { createRouteShell } from "../shell/admitted-mount";
import { sourceRouteServices } from "../shell/source-route-services";
import { placeInput } from "../shell/admitted-place.test-fixture";
import { chatLocalPort, chatLocalSchemas } from "./local";
import type { ChatRouteDeps } from "./graph";
import { chatOutcome, runChatCommand } from "./graph";

const closes: (() => void)[] = [];
afterEach(() => {
  cleanup();
  closes.splice(0).forEach((close) => close());
});
async function witness(
  deps: ChatRouteDeps,
  options: { capability?: boolean; port?: boolean; badOutput?: boolean } = {},
) {
  const source = { module: "chat/local.test.tsx", export: "witness" };
  const command = (entry: string, intent: string, input: string) => ({
    kind: "local" as const,
    entry,
    intent,
    input,
    label: entry,
    review: "none" as const,
    deps: { page: ["thread"], readings: [], work: [] },
    captures: [],
  });
  const module = {
    ...captures,
    schemas: {
      ...captures.schemas,
      ...chatLocalSchemas,
      thread: z.string(),
      prompt: z.object({ text: z.string() }),
      empty: z.object({}),
    },
    data: {
      ...captures.data,
      capabilities: options.capability === false ? [] : (["local"] as const),
      fields: {
        ...captures.data.fields,
        thread: {
          role: "query" as const,
          schema: "thread",
          codec: "thread",
          initial: deps.thread,
          url: "replace" as const,
          share: true,
          agent: "set" as const,
        },
      },
      local: {
        "thread.prompt": { input: "promptCommand", output: "acknowledged" },
        "thread.cancel": { input: "threadCommand", output: "acknowledged" },
        "thread.fork": { input: "threadCommand", output: "acknowledged" },
      },
      verbs: {
        send: command("thread.prompt", "send", "prompt"),
        stop: command("thread.cancel", "stop", "empty"),
        fork: command("thread.fork", "fork", "empty"),
      },
      readings: { captures: { ...captures.data.readings.captures, demand: "explicit" as const } },
      panes: {
        captures: { ...captures.data.panes.captures, draws: [], verbs: ["send", "stop", "fork"] },
      },
    },
    codecs: {
      ...captures.codecs,
      thread: { encode: String, decode: (value: string) => ({ ok: true as const, value }) },
    },
    bodies: {
      ...captures.bodies,
      send: {
        slot: "verbs.send.intent",
        kind: "intent",
        source,
        run: (ctx: { page: { thread: string } }, prompt: unknown) => ({
          thread: ctx.page.thread,
          prompt,
        }),
      },
      stop: {
        slot: "verbs.stop.intent",
        kind: "intent",
        source,
        run: (ctx: { page: { thread: string } }) => ({ thread: ctx.page.thread }),
      },
      fork: {
        slot: "verbs.fork.intent",
        kind: "intent",
        source,
        run: (ctx: { page: { thread: string } }) => ({ thread: ctx.page.thread }),
      },
      main: {
        slot: "panes.captures.body",
        kind: "pane",
        source,
        run: (ctx: { verbs: Record<string, (input: unknown) => unknown> }) =>
          createElement("button", { onClick: () => ctx.verbs.send({ text: "look" }) }, "Send"),
      },
    },
  };
  const envelope = {
    source: "builtin-closure" as const,
    version: 1 as const,
    data: module.data,
    variants: [{ client: "web" as const, entry: "witness.ts" }],
    modules: [{ id: "witness.ts", sha256: "a".repeat(64) }],
    inputs: [],
    externals: [],
  };
  const fingerprint = await builtinClosureFingerprint(envelope);
  const inventory = createBuiltinRouteInventory({
    chat: {
      module,
      closure: { envelope, fingerprint },
      catalog: Object.entries(module.entries).map(([key, entry]) => ({
        key,
        ...entry.axes,
        uses: [],
      })),
    },
  });
  const admission = (await inventory.prepare("chat", fingerprint)).admitUnknown(module);
  if (!admission.ok) return { admission };
  const native = vi.fn(() => {
    throw Error("Native submission forbidden");
  });
  const port = chatLocalPort(() => deps);
  const calls: AbortSignal[] = [];
  const mount = createRouteShell({
    ...sourceRouteServices({}),
    submitNative: native,
    local:
      options.port === false
        ? undefined
        : async (call, signal) => {
            calls.push(signal);
            return options.badOutput ? "bad" : port(call, signal);
          },
  }).mount(
    admission.route,
    placeInput({ read: () => new URLSearchParams(), write() {}, subscribe: () => () => {} }),
  );
  closes.push(mount.dispose);
  return { admission, mount, native, calls };
}
const mounted = async (...args: Parameters<typeof witness>) => {
  const result = await witness(...args);
  if (!result.mount) throw Error(JSON.stringify(result.admission));
  return result as Required<typeof result>;
};
test("rendered admitted Send crosses the real provider adapter; Stop can acknowledge during Send", async () => {
  let acknowledge!: () => void;
  const send = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  );
  const cancel = vi.fn(async () => {});
  const { mount, native, calls } = await mounted({ thread: "t", ready: true, send, cancel });
  render(mount.read("captures") as React.ReactNode);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ text: "look", delivery: "steer" }));
  mount.invoke("stop", {});
  await vi.waitFor(() => expect(chatOutcome(mount, "stop")?.state).toBe("succeeded"));
  expect(calls[0]!.aborted).toBe(false);
  expect(chatOutcome(mount, "send")?.state).toBe("running");
  acknowledge();
  await vi.waitFor(() => expect(chatOutcome(mount, "send")?.state).toBe("succeeded"));
  expect(cancel).toHaveBeenCalledOnce();
  expect(native).not.toHaveBeenCalled();
});
test("retiring a pending fork aborts observation and cannot publish success to the replacement Page", async () => {
  let acknowledge!: () => void;
  const f = await mounted({
    thread: "t",
    forkThread: () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  });
  f.mount.invoke("fork", {});
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  f.mount.peaMove({ thread: "replacement" });
  expect(f.calls[0]!.aborted).toBe(true);
  acknowledge();
  await Promise.resolve();
  expect(chatOutcome(f.mount, "fork")?.state).toBe("stale");
  expect(f.mount.page.read().thread).toBe("replacement");
  expect(f.native).not.toHaveBeenCalled();
});
test("missing capability/port and invalid output refuse at the admitted boundary", async () => {
  expect((await witness({ thread: "t" }, { capability: false })).admission.ok).toBe(false);
  const absent = await mounted({ thread: "t" }, { port: false });
  expect(absent.mount.localReadiness("send", { text: "look" })).toBe("Local commands unavailable");
  expect(() => absent.mount.invoke("send", { text: "look" })).toThrow("Local commands unavailable");
  const bad = await mounted({ thread: "t" }, { badOutput: true });
  bad.mount.invoke("send", { text: "look" });
  await vi.waitFor(() =>
    expect(chatOutcome(bad.mount, "send")).toMatchObject({
      state: "failed",
      reason: "local-output-invalid",
    }),
  );
  expect(absent.native).not.toHaveBeenCalled();
  expect(bad.native).not.toHaveBeenCalled();
});
test("closing the owner settles the pending observer without claiming provider cancellation", async () => {
  let acknowledge!: () => void;
  const cancel = vi.fn(async () => {});
  const f = await mounted({
    thread: "t",
    cancel,
    send: () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      }),
  });
  const result = runChatCommand(f.mount, "send", { text: "look" });
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  f.mount.close();
  expect(await result).toBe("Mount closed");
  expect(f.calls[0]!.aborted).toBe(true);
  expect(cancel).not.toHaveBeenCalled();
  acknowledge();
  expect(f.native).not.toHaveBeenCalled();
});
