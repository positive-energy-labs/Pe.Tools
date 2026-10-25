import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { BrowserPage, CdpClient, CdpEvent } from "../../src/index.ts";

/** A durable test witness around the public API; no CDP messages are synthesized here. */
export async function actionTrace(path: string) {
  await mkdir(dirname(path), { recursive: true });
  let phase = "acquire";
  let sequence = 0;
  let lastEvent: { at: string; event: CdpEvent } | undefined;
  let writes = Promise.resolve();
  const unsubscribers: (() => void)[] = [];
  const record = (entry: Record<string, unknown>) => {
    const line = JSON.stringify({ at: new Date().toISOString(), phase, ...entry }) + "\n";
    writes = writes.then(() => appendFile(path, line));
    return writes;
  };
  const instrument = <T extends CdpClient>(original: T, targetId: string): T => {
    unsubscribers.push(
      original.subscribe((event) => {
        lastEvent = { at: new Date().toISOString(), event };
        void record({ kind: "event", targetId, event });
      }),
    );
    return new Proxy(original, {
      get(target, property) {
        if (property !== "send" && property !== "sendRaw") return Reflect.get(target, property);
        return async (method: string, ...args: unknown[]) => {
          const id = ++sequence;
          const commandPhase = phase;
          const context = {
            id,
            phase: commandPhase,
            targetId,
            method,
            params: args[0] ?? {},
          };
          await record({ kind: "command-start", ...context, lastEvent });
          try {
            const result = await Reflect.apply(target[property], target, [method, ...args]);
            const evaluated =
              method === "Runtime.evaluate" && result && typeof result === "object"
                ? (result as { result?: { type?: string; value?: unknown } }).result
                : undefined;
            await record({
              kind: "command-end",
              ...context,
              ...(evaluated ? { readback: evaluated } : {}),
              lastEvent,
            });
            return result;
          } catch (cause) {
            const error = cause as Error & {
              code?: string;
              method?: string;
              outcome?: string;
              requestId?: string | number;
            };
            await record({
              kind: "command-failed",
              ...context,
              error: {
                message: error.message,
                code: error.code,
                method: error.method,
                outcome: error.outcome,
                requestId: error.requestId,
              },
              lastEvent,
            });
            throw cause;
          }
        };
      },
    });
  };
  return {
    path,
    page: (original: BrowserPage) => instrument(original, original.targetId),
    client: (original: CdpClient) => instrument(original, "browser"),
    async phase(name: string, context: Record<string, unknown> = {}) {
      phase = name;
      await record({ kind: "phase", ...context, lastEvent });
    },
    async finish() {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      await record({ kind: "trace-finished", lastEvent });
    },
  };
}
