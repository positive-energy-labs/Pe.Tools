import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { CLOSE_BUDGET_MS, readClosingState, readSessionReceipt } from "./receipts.ts";
import { BrowserError } from "./errors.ts";
import { evaluator } from "./evaluate.ts";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js";
import type { BrowserPage, BrowserSession, SessionInfo, SessionReceipt } from "./browser.ts";
import type { CdpEvent, CdpTarget, CommandOptions } from "./cdp.ts";

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
}
export class SessionClient implements BrowserSession {
  readonly info: SessionInfo;
  onDisconnected?: () => void;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, Set<(event: CdpEvent) => void>>();
  private closed = false;
  private closePromise?: Promise<void>;
  private socket: Socket;
  private receipt: SessionReceipt;
  readonly clientId: string;
  private constructor(socket: Socket, receipt: SessionReceipt, clientId: string) {
    this.socket = socket;
    this.receipt = receipt;
    this.clientId = clientId;
    this.info = receipt.info;
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 64 * 1024 * 1024) {
        socket.destroy(new Error("Keeper response too large"));
        return;
      }
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        let message: {
          id?: string;
          result?: unknown;
          error?: Record<string, unknown>;
          targetId?: string;
          event?: CdpEvent;
        };
        try {
          message = JSON.parse(line);
        } catch {
          socket.destroy(new Error("Invalid keeper response"));
          return;
        }
        if (message.event && message.targetId)
          for (const listener of this.listeners.get(message.targetId) ?? []) {
            try {
              Promise.resolve(listener(message.event)).catch(() => {});
            } catch {}
          }
        if (!message.id) continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        pending.cleanup();
        if (message.error)
          pending.reject(
            new BrowserError(
              typeof message.error.code === "string" ? message.error.code : "LifecycleError",
              String(message.error.message),
              message.error,
            ),
          );
        else pending.resolve(message.result);
      }
    });
    const disconnected = () => {
      if (this.closed) return;
      this.closed = true;
      for (const pending of this.pending.values()) {
        pending.cleanup();
        pending.reject(
          new BrowserError(
            "Disconnected",
            "Keeper connection closed; dispatched commands may have unknown outcome",
            { outcome: "unknown" },
          ),
        );
      }
      this.pending.clear();
      this.listeners.clear();
      this.onDisconnected?.();
    };
    socket.on("error", disconnected);
    socket.on("close", disconnected);
  }
  static async connect(
    receipt: SessionReceipt,
    clientId: string = randomUUID(),
  ): Promise<SessionClient> {
    const socket = createConnection({ host: "127.0.0.1", port: receipt.controlPort });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("Keeper connection timed out"));
      }, 3000);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const client = new SessionClient(socket, receipt, clientId);
    try {
      await client.call("info");
      return client;
    } catch (error) {
      socket.destroy();
      throw error;
    }
  }
  private call(
    op: string,
    args: Record<string, unknown> = {},
    options: CommandOptions = {},
  ): Promise<unknown> {
    if (this.closed)
      return Promise.reject(
        new BrowserError("Disconnected", "Session client disconnected", { outcome: "not-sent" }),
      );
    if (options.signal?.aborted)
      return Promise.reject(
        new BrowserError("Aborted", "Command aborted", { outcome: "not-sent" }),
      );
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const cancel = (code: string) => {
        if (!this.pending.delete(id)) return;
        cleanup();
        this.socket.write(
          JSON.stringify({
            token: this.receipt.token,
            id: randomUUID(),
            op: "cancel",
            args: { requestId: id },
          }) + "\n",
        );
        reject(
          new BrowserError(
            code,
            code === "Timeout" ? "Command deadline exceeded" : "Command aborted",
            { requestId: id, outcome: "unknown" },
          ),
        );
      };
      const abort = () => cancel("Aborted");
      const timer = setTimeout(() => cancel("Timeout"), (options.timeoutMs ?? 30000) + 1000);
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      options.signal?.addEventListener("abort", abort, { once: true });
      this.socket.write(
        JSON.stringify({
          token: this.receipt.token,
          id,
          clientId: this.clientId,
          op,
          args: { ...args, timeoutMs: options.timeoutMs },
        }) + "\n",
      );
    });
  }
  targets(): Promise<CdpTarget[]> {
    return this.call("targets") as Promise<CdpTarget[]>;
  }
  protocol(): Promise<Record<string, unknown>> {
    return this.call("protocol") as Promise<Record<string, unknown>>;
  }
  sendRaw(
    method: string,
    params: Record<string, unknown> = {},
    options?: CommandOptions,
  ): Promise<unknown> {
    return this.call("browser.send", { method, params }, options);
  }
  async page(
    options: { targetId?: string; url?: string; clientId?: string } = {},
  ): Promise<BrowserPage> {
    const { targetId } = (await this.call("page", options)) as { targetId: string };
    const listeners = new Set<(event: CdpEvent) => void>();
    this.listeners.set(targetId, listeners);
    let released = false;
    const sendRaw = (
      method: string,
      params: Record<string, unknown> = {},
      command: CommandOptions = {},
    ) => {
      if (released)
        return Promise.reject(
          new BrowserError("LeaseReleased", "Page lease released", { outcome: "not-sent" }),
        );
      if (command.sessionId)
        return Promise.reject(
          new BrowserError("InvalidOptions", "Page routing cannot override sessionId", {
            outcome: "not-sent",
          }),
        );
      return this.call("page.send", { targetId, method, params }, command);
    };
    return {
      targetId,
      send: ((method: string, ...params: Record<string, unknown>[]) =>
        sendRaw(method, params[0])) as <M extends keyof ProtocolMapping.Commands>(
        method: M,
        ...params: ProtocolMapping.Commands[M]["paramsType"]
      ) => Promise<ProtocolMapping.Commands[M]["returnType"]>,
      sendRaw,
      evaluate: evaluator(sendRaw),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      close: async () => {
        if (released) return;
        await this.call("page.close", { targetId });
        released = true;
        this.listeners.delete(targetId);
      },
      release: async () => {
        if (released) return;
        await this.call("page.release", { targetId });
        released = true;
        this.listeners.delete(targetId);
      },
    };
  }
  close(): Promise<void> {
    return (this.closePromise ??= this.finishClose());
  }
  private async finishClose(): Promise<void> {
    try {
      if (this.closed) {
        const receipt = (await readSessionReceipt(this.info.receipt))!;
        if (receipt.status === "closed") {
          if (receipt.error)
            throw new BrowserError(receipt.errorCode ?? "CleanupFailed", receipt.error);
          return;
        }
        if (!(await readClosingState(this.info.receipt))) {
          const replacement = await SessionClient.connect(receipt, this.clientId);
          await replacement.close();
          return;
        }
      } else {
        try {
          await this.call("close");
        } finally {
          await this.disconnect();
        }
      }
    } catch (error) {
      // Caller EOF can start cleanup before its closing receipt is published or reconnect answers.
      // A lost control socket is not a cleanup verdict; wait for the existing terminal receipt.
      const code = (error as { code?: string } | undefined)?.code;
      if (!["SessionClosed", "Disconnected", "ECONNREFUSED", "ECONNRESET"].includes(code ?? ""))
        throw error;
    }
    let deadline = Date.now() + CLOSE_BUDGET_MS;
    while (Date.now() < deadline) {
      const closing = await readClosingState(this.info.receipt);
      if (closing && closing.receiptId === this.info.receiptId)
        deadline = closing.deadlineMs + 1000;
      const receipt = (await readSessionReceipt(this.info.receipt, false, true))!;
      if (receipt.status === "closed") {
        if (receipt.error)
          throw new BrowserError(receipt.errorCode ?? "CleanupFailed", receipt.error);
        return;
      }
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new BrowserError(
      "CleanupTimeout",
      "Keeper did not certify cleanup by its shutdown deadline",
      {
        outcome: "unknown",
      },
    );
  }
  async disconnect(): Promise<void> {
    if (this.closed) return;
    const finished = new Promise<void>((resolve) => this.socket.once("close", resolve));
    this.socket.end();
    await finished;
  }
}
