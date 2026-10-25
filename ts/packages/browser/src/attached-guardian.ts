import { randomUUID } from "node:crypto";
import { readFile, writeFile, open } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Effect, Semaphore } from "effect";
import { connectCdp, type CdpClient, type CommandOptions } from "./cdp.ts";
import { BrowserError } from "./errors.ts";
import { releaseAttachment, type AttachmentLock } from "./attachment-lock.ts";
import { publishJson } from "./receipts.ts";

interface GuardianConfig {
  endpoint: string;
  receipt: string;
  lock: AttachmentLock;
  timeoutMs: number;
}
interface Forward {
  id: number;
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}
const proxyError = (error: BrowserError) => ({
  code: error.code,
  message: error.message,
  method: error.method,
  outcome: error.outcome,
  protocolCode: error.protocolCode,
  requestId: error.requestId,
  data: error.data,
});

/** The guardian owns the original consented socket; the keeper owns only this pipe client. */
export function guardianClient(pipe: CdpClient): CdpClient {
  const sendRaw = async (
    method: string,
    params: Record<string, unknown> = {},
    options: CommandOptions = {},
  ): Promise<unknown> => {
    const requestKey = randomUUID();
    const cancel = () => {
      void pipe.sendRaw("PeBrowser.cancel", { requestKey }, { timeoutMs: 1000 }).catch(() => {});
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    try {
      return await pipe.sendRaw(
        "PeBrowser.forward",
        { method, params, requestKey, timeoutMs: options.timeoutMs },
        options,
      );
    } catch (error) {
      const failure = error as BrowserError;
      const payload = failure.data as
        | { peBrowserError?: ReturnType<typeof proxyError> }
        | undefined;
      if (payload?.peBrowserError) {
        const detail = payload.peBrowserError;
        throw new BrowserError(detail.code, detail.message, {
          ...detail,
          sessionId: options.sessionId,
        });
      }
      throw new BrowserError(failure.code, failure.message, {
        method,
        requestId: failure.requestId,
        sessionId: options.sessionId,
        outcome: failure.outcome,
        protocolCode: failure.protocolCode,
        data: failure.data,
        cause: error,
      });
    } finally {
      options.signal?.removeEventListener("abort", cancel);
    }
  };
  return {
    ...pipe,
    sendRaw,
    send: ((method: string, ...params: Record<string, unknown>[]) =>
      sendRaw(method, params[0])) as CdpClient["send"],
  };
}

export async function runAttachedGuardian(configFile: string): Promise<void> {
  const config: GuardianConfig = JSON.parse(await readFile(configFile, "utf8"));
  const directory = dirname(config.receipt);
  const owned = new Set<string>();
  const creates = new Set<Promise<void>>();
  const unknownCreates: string[] = [];
  const controllers = new Map<string, { controller: AbortController; create: boolean }>();
  const serial = Semaphore.makeUnsafe(1);
  let cdp: CdpClient | undefined;
  let ending = false;
  let buffer = "";
  let cleanup: Promise<void> | undefined;
  const acquisition = new AbortController();
  const connectionOpenedAt = new Date().toISOString();
  let opened = false;
  const exit = { pid: process.pid, connectionOpenedAt, exitCode: 0 };
  process.once("exit", (code) => {
    try {
      writeFileSync(
        join(directory, "guardian-exit.json"),
        JSON.stringify({ ...exit, exitCode: code, when: new Date().toISOString() }),
      );
    } catch {}
  });
  const send = (message: unknown) => {
    if (ending || process.stdout.destroyed) return;
    try {
      process.stdout.write(JSON.stringify(message) + "\0", (error) => {
        if (error) void beginCleanup();
      });
    } catch {
      void beginCleanup();
    }
  };
  const recordOwned = (targetId: string) =>
    Effect.runPromise(
      serial.withPermit(
        Effect.tryPromise(async () => {
          owned.add(targetId);
          const file = await open(join(directory, "guardian-created.jsonl"), "a", 0o600);
          try {
            await file.writeFile(
              JSON.stringify({ targetId, when: new Date().toISOString() }) + "\n",
            );
            await file.sync();
          } finally {
            await file.close();
          }
        }),
      ),
    );
  const beginCleanup = () => {
    if (cleanup) return cleanup;
    ending = true;
    if (!opened) acquisition.abort();
    for (const operation of controllers.values())
      if (!operation.create) operation.controller.abort();
    cleanup = (async () => {
      const startedAt = new Date().toISOString();
      const errors: string[] = [];
      await Promise.allSettled(creates);
      errors.push(...unknownCreates);
      let before: string[] = [];
      let after: string[] = [];
      if (cdp) {
        const targets = async () =>
          (
            (await cdp!.sendRaw("Target.getTargets", {}, { timeoutMs: 3000 })) as {
              targetInfos: { targetId: string }[];
            }
          ).targetInfos.map((target) => target.targetId);
        try {
          before = await targets();
          for (const targetId of owned)
            if (before.includes(targetId)) {
              try {
                await cdp.sendRaw("Target.closeTarget", { targetId }, { timeoutMs: 3000 });
              } catch (error) {
                errors.push(String(error));
              }
            }
          after = await targets();
        } catch (error) {
          errors.push(String(error));
        }
        await cdp.close();
      }
      await publishJson(join(directory, "attached-cleanup.json"), {
        status: "closed",
        guardianPid: process.pid,
        connections: opened ? 1 : 0,
        connectionOpenedAt,
        startedAt,
        finishedAt: new Date().toISOString(),
        createdTargetIds: [...owned],
        beforeTargetIds: before,
        afterTargetIds: after,
        remainingOwned: [...owned].filter((id) => after.includes(id)),
        errors,
      });
      await releaseAttachment(config.lock);
      process.stdin.destroy();
      if (errors.length) process.exitCode = 1;
    })();
    cleanup.catch((error) => {
      process.stderr.write(String(error));
      process.exitCode = 1;
    });
    return cleanup;
  };
  // Broken keeper stdout is a cleanup signal, not an unhandled exception before finalization.
  process.stdout.on("error", () => {
    void beginCleanup();
  });
  process.stdin.on("error", () => {
    void beginCleanup();
  });
  process.stdin.once("end", () => {
    void beginCleanup();
  });
  let forward: ((request: Forward) => void) | undefined;
  const drain = () => {
    if (!forward || ending) return;
    let index: number;
    while ((index = buffer.indexOf("\0")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      try {
        const request = JSON.parse(line) as Forward;
        if (!Number.isSafeInteger(request.id)) throw new Error("Invalid proxy request");
        forward(request);
      } catch {
        void beginCleanup();
        return;
      }
    }
  };
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk: string) => {
    if (ending) return;
    buffer += chunk;
    if (buffer.length > 64 * 1024 * 1024) {
      void beginCleanup();
      return;
    }
    drain();
  });
  // Observe EOF while Chrome is waiting for approval; queue commands until acquisition succeeds.
  process.stdin.resume();
  try {
    cdp = await connectCdp(config.endpoint, {
      timeoutMs: config.timeoutMs,
      signal: acquisition.signal,
    });
    opened = true;
    if (ending) {
      await cdp.close();
      await cleanup;
      return;
    }
    cdp.subscribe((event) => send(event));
    forward = (request: Forward) => {
      if (request.method === "PeBrowser.cancel") {
        const item = controllers.get(String(request.params?.requestKey));
        if (item && !item.create) item.controller.abort();
        send({ id: request.id, result: {} });
        return;
      }
      if (request.method !== "PeBrowser.forward" || typeof request.params?.method !== "string") {
        send({
          id: request.id,
          error: { code: -32601, message: "Invalid guardian proxy method" },
          sessionId: request.sessionId,
        });
        return;
      }
      const method = request.params.method;
      const controller = new AbortController();
      const create = method === "Target.createTarget";
      const key = String(request.params.requestKey);
      controllers.set(key, { controller, create });
      const task = (async () => {
        try {
          const result = await cdp!.sendRaw(
            method,
            (request.params?.params as Record<string, unknown>) ?? {},
            {
              sessionId: request.sessionId,
              timeoutMs: create
                ? 10000
                : typeof request.params?.timeoutMs === "number"
                  ? request.params.timeoutMs
                  : undefined,
              ...(create ? {} : { signal: controller.signal }),
            },
          );
          // Authority is guardian-owned and durable BEFORE a successful create reply can escape.
          if (create && typeof (result as { targetId?: unknown }).targetId === "string")
            await recordOwned((result as { targetId: string }).targetId);
          send({
            id: request.id,
            result,
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          });
        } catch (error) {
          const e = error as BrowserError;
          if (create && e.outcome === "unknown")
            unknownCreates.push(`Unresolved create outcome: ${e.code}: ${e.message}`);
          send({
            id: request.id,
            error: {
              code: e.protocolCode ?? -32000,
              message: e.message,
              data: { peBrowserError: proxyError(e) },
            },
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          });
        } finally {
          controllers.delete(key);
        }
      })();
      if (create) {
        creates.add(task);
        void task.finally(() => creates.delete(task));
      }
    };
    drain();
    if (!process.stdin.destroyed)
      await new Promise<void>((done) => process.stdin.once("close", done));
    await beginCleanup();
  } catch (error) {
    await writeFile(
      join(directory, "guardian-start-error.json"),
      JSON.stringify(proxyError(error as BrowserError)),
      { mode: 0o600 },
    );
    await beginCleanup();
    throw error;
  }
}
