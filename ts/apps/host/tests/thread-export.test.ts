import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { emptyThreadHead, emptyThreadLifecycle, type HarnessEvent } from "@pe/agent-contracts";
import { createPeClient, servePeRoute } from "@pe/agent-contracts/pe-api";
import { createHarnessThreads } from "../src/harness/threads.ts";
import type { Providers } from "../src/harness/providers.ts";

const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
test("public export pins the full durable thread, including tool results, without starting a harness", async () => {
  const root = mkdtempSync(join(tmpdir(), "pe-thread-export-"));
  const outside = mkdtempSync(join(tmpdir(), "pe-thread-export-outside-"));
  const dir = join(root, "thread-1");
  mkdirSync(dir);
  const meta =
    JSON.stringify(
      {
        id: "thread-1",
        title: "Duct review",
        harness: "codex",
        providerId: "codex",
        providerName: "Codex",
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        modelId: "test",
        acpSessionId: "acp-1",
        models: [],
        traits: [],
        traitValues: {},
        head: emptyThreadHead,
        lifecycle: emptyThreadLifecycle(),
        forkOf: null,
        promptCapabilities: null,
      },
      null,
      2,
    ) + "\n";
  const events: HarnessEvent[] = [
    {
      seq: 1,
      at: "2026-10-13T00:00:00.000Z",
      kind: "prompt",
      turnId: "turn-1",
      text: "Check duct 42",
    },
    {
      seq: 2,
      at: "2026-10-13T00:00:01.000Z",
      kind: "update",
      turnId: "turn-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: { elementId: 42, result: "<duct>$&" },
      },
    },
    {
      seq: 3,
      at: "2026-10-13T00:00:02.000Z",
      kind: "update",
      turnId: "turn-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Duct checked." },
      },
    },
    {
      seq: 4,
      at: "2026-10-13T00:00:03.000Z",
      kind: "turn_end",
      turnId: "turn-1",
      stopReason: "end_turn",
    },
  ];
  const log = events.map((event) => JSON.stringify(event)).join("\r\n") + "\r\n";
  writeFileSync(join(dir, "meta.json"), meta);
  writeFileSync(join(dir, "events.jsonl"), log);
  const host = createHarnessThreads({
    root,
    worldRoot: root,
    mcpServer: () => {
      throw Error("export must not spawn");
    },
    providers: { get: () => undefined, keys: () => [] } as unknown as Providers,
  });
  try {
    const response = await servePeRoute(
      new Request("http://host/pe/threads/thread-1/export"),
      host.fetch,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(
      /attachment; filename="thread-1-.*\.json"/,
    );
    const content = await response.text();
    const hash = sha(content);
    expect(response.headers.get("x-pe-export-sha256")).toBe(hash);
    expect(readFileSync(join(root, ".exports", `${hash}.json`), "utf8")).toBe(content);
    const archive = JSON.parse(content);
    expect(archive.metadata).toEqual(JSON.parse(meta));
    expect(archive.events).toEqual(events);
    expect(archive.lastSeq).toBe(4);
    for (const [name, bytes] of [
      ["meta.json", meta],
      ["events.jsonl", log],
    ]) {
      const source = archive.sources.find((file: { path: string }) => file.path === name);
      expect(Buffer.from(source.bytesBase64, "base64").toString("utf8")).toBe(bytes);
      expect(source.sha256).toBe(sha(bytes!));
    }
    expect(readFileSync(join(dir, "meta.json"), "utf8")).toBe(meta);
    expect(readFileSync(join(dir, "events.jsonl"), "utf8")).toBe(log);
    const client = createPeClient("http://host", (url, init) =>
      servePeRoute(new Request(url, init), host.fetch),
    );
    expect((await client.response("thread.export", { params: { id: "thread-1" } })).status).toBe(
      200,
    );
    const download = () =>
      servePeRoute(new Request("http://host/pe/threads/thread-1/export"), host.fetch);
    for (const invalid of [
      log + "{",
      log + "{\n",
      JSON.stringify({ ...events[0], seq: 2 }) + "\n",
    ]) {
      writeFileSync(join(dir, "events.jsonl"), invalid);
      expect((await download()).status).toBe(422);
      expect(readFileSync(join(dir, "events.jsonl"), "utf8")).toBe(invalid);
    }
    writeFileSync(join(dir, "events.jsonl"), "");
    expect((await (await download()).json()).events).toEqual([]);
    unlinkSync(join(dir, "events.jsonl"));
    const empty = await download();
    expect(empty.status).toBe(200);
    const emptyArchive = await empty.json();
    expect(emptyArchive.events).toEqual([]);
    expect(
      emptyArchive.sources.find((file: { path: string }) => file.path === "events.jsonl"),
    ).toMatchObject({ present: false, bytesBase64: "", sha256: sha("") });
    renameSync(dir, join(root, "original"));
    symlinkSync(outside, dir, "junction");
    expect((await download()).status).toBe(422);
  } finally {
    await host.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
