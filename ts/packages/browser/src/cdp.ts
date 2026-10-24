import { Effect } from "effect";
import type { Scope } from "effect";
import type { ProtocolMapping } from "devtools-protocol/types/protocol-mapping.js";
import WebSocket from "ws";
import { BrowserError } from "./errors.ts";

export interface CdpEvent {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface CommandOptions {
  sessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/** The caller hands custody of these two dedicated CDP streams to the client. */
export interface PipeEndpoint {
  readable: NodeJS.ReadableStream;
  writable: NodeJS.WritableStream;
}

export interface ConnectOptions {
  timeoutMs?: number;
  /** Cancels acquisition only. Commands have their own cancellation signal. */
  signal?: AbortSignal;
}

export interface CdpClient {
  send<M extends keyof ProtocolMapping.Commands>(
    method: M,
    ...params: ProtocolMapping.Commands[M]["paramsType"]
  ): Promise<ProtocolMapping.Commands[M]["returnType"]>;
  sendRaw(
    method: string,
    params?: Record<string, unknown>,
    options?: CommandOptions,
  ): Promise<unknown>;
  subscribe(listener: (event: CdpEvent) => void): () => void;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT = 30_000;
const MAX_FRAME = 256 * 1024 * 1024;

function deadline(value = DEFAULT_TIMEOUT): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647) {
    throw new BrowserError("InvalidArgument", "timeoutMs must be positive and at most 2147483647", {
      outcome: "not-sent",
    });
  }
  return value;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface Pending {
  method: string;
  sessionId?: string;
  resolve: (value: unknown) => void;
  reject: (error: BrowserError) => void;
  cleanup: () => void;
}

interface Transport {
  write: (payload: string) => void;
  close: () => void;
}

/** One correlation engine for both transports and both Promise/Effect entry points. */
async function acquireClient(
  endpoint: string | PipeEndpoint,
  options: ConnectOptions = {},
): Promise<CdpClient> {
  const timeoutMs = deadline(options.timeoutMs);
  const endpointName = typeof endpoint === "string" ? endpoint : "pipe";
  const context = { endpoint: endpointName };
  if (options.signal?.aborted) {
    throw new BrowserError("Aborted", "CDP connection cancelled before opening", {
      ...context,
      outcome: "not-sent",
      cause: options.signal.reason,
    });
  }
  let transport: Transport | undefined;
  let closed: BrowserError | undefined;
  let ready = false;
  let nextId = 0;
  const pending = new Map<number, Pending>();
  const listeners = new Set<(event: CdpEvent) => void>();
  const detached = new Set<string>();
  let resolveConnection!: (client: CdpClient) => void;
  let rejectConnection!: (error: BrowserError) => void;
  const connected = new Promise<CdpClient>((resolve, reject) => {
    resolveConnection = resolve;
    rejectConnection = reject;
  });

  const finish = (id: number, error?: BrowserError, value?: unknown) => {
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    call.cleanup();
    if (error) call.reject(error);
    else call.resolve(value);
  };
  const cleanupAcquisition = () => {
    clearTimeout(connectionTimer);
    options.signal?.removeEventListener("abort", abortConnection);
  };
  const shutdown = (error: BrowserError) => {
    if (closed) return;
    closed = error;
    cleanupAcquisition();
    listeners.clear();
    for (const [id, call] of pending) {
      finish(
        id,
        new BrowserError(error.code, error.message, {
          ...context,
          method: call.method,
          requestId: id,
          sessionId: call.sessionId,
          outcome: "unknown",
          cause: error,
        }),
      );
    }
    if (!ready) rejectConnection(error);
    transport?.close();
  };
  const failedTransport = (cause: unknown) =>
    shutdown(
      new BrowserError(
        ready ? "Disconnected" : "ConnectionFailed",
        ready ? "CDP transport disconnected" : "CDP connection failed",
        { ...context, cause, outcome: "not-sent" },
      ),
    );

  const receive = (text: string) => {
    if (closed) return;
    try {
      const message: unknown = JSON.parse(text);
      if (!object(message)) throw new Error("Expected a CDP object");
      if ("id" in message) {
        if (!Number.isSafeInteger(message.id)) throw new Error("Invalid CDP response id");
        const id = message.id as number;
        const call = pending.get(id);
        // A cancelled/timed-out command can still return; never replay it or deliver it twice.
        if (!call) return;
        if (message.sessionId !== call.sessionId)
          throw new Error("CDP response session does not match request");
        if ("error" in message) {
          if (
            !object(message.error) ||
            typeof message.error.message !== "string" ||
            typeof message.error.code !== "number"
          ) {
            throw new Error("Malformed CDP protocol error");
          }
          finish(
            id,
            new BrowserError("ProtocolError", message.error.message, {
              ...context,
              method: call.method,
              requestId: id,
              sessionId: call.sessionId,
              outcome: "rejected",
              protocolCode: message.error.code,
              data: message.error.data,
            }),
          );
        } else if ("result" in message) finish(id, undefined, message.result);
        else throw new Error("CDP response has neither result nor error");
        return;
      }
      if (
        typeof message.method !== "string" ||
        (message.params !== undefined && !object(message.params)) ||
        (message.sessionId !== undefined && typeof message.sessionId !== "string")
      ) {
        throw new Error("Malformed CDP event");
      }
      const event: CdpEvent = {
        method: message.method,
        params: (message.params ?? {}) as Record<string, unknown>,
        ...(typeof message.sessionId === "string" ? { sessionId: message.sessionId } : {}),
      };
      if (
        event.method === "Target.detachedFromTarget" &&
        typeof event.params.sessionId === "string"
      ) {
        const sessionId = event.params.sessionId;
        detached.add(sessionId);
        for (const [id, call] of pending) {
          if (call.sessionId === sessionId)
            finish(
              id,
              new BrowserError("Disconnected", "CDP target session detached", {
                ...context,
                method: call.method,
                requestId: id,
                sessionId,
                outcome: "unknown",
              }),
            );
        }
      }
      const subscribers = Array.from(listeners);
      for (const listener of subscribers) {
        if (!listeners.has(listener)) continue;
        try {
          // `void` callbacks can still return a rejected Promise at runtime.
          void Promise.resolve(listener(event)).catch(() => {});
        } catch {
          /* A consumer cannot take down another consumer or the receive loop. */
        }
      }
    } catch (cause) {
      shutdown(
        new BrowserError("InvalidResponse", "Invalid CDP message", {
          ...context,
          cause,
          outcome: "unknown",
        }),
      );
    }
  };

  const sendRaw: CdpClient["sendRaw"] = async (method, params = {}, command = {}) => {
    const commandContext = {
      ...context,
      method,
      sessionId: command.sessionId,
      outcome: "not-sent" as const,
    };
    if (closed)
      throw new BrowserError("Closed", "CDP client is closed", {
        ...commandContext,
        cause: closed,
      });
    if (command.signal?.aborted)
      throw new BrowserError("Aborted", "CDP command cancelled before sending", {
        ...commandContext,
        cause: command.signal.reason,
      });
    if (
      typeof method !== "string" ||
      !method.trim() ||
      !object(params) ||
      (command.sessionId !== undefined &&
        (typeof command.sessionId !== "string" || !command.sessionId))
    ) {
      throw new BrowserError(
        "InvalidArgument",
        "Expected a CDP method, object params and optional session id",
        commandContext,
      );
    }
    if (command.sessionId && detached.has(command.sessionId)) {
      throw new BrowserError("Disconnected", "CDP target session is detached", commandContext);
    }
    const timeout = deadline(command.timeoutMs);
    const id = ++nextId;
    let payload: string;
    try {
      payload = JSON.stringify({
        id,
        method,
        params,
        ...(command.sessionId ? { sessionId: command.sessionId } : {}),
      });
    } catch (cause) {
      throw new BrowserError("InvalidArgument", "CDP parameters are not JSON serializable", {
        ...commandContext,
        cause,
      });
    }
    // Serialization can execute user-defined toJSON hooks, including cancellation/close.
    if (closed)
      throw new BrowserError("Closed", "CDP client closed before sending", commandContext);
    if (command.signal?.aborted)
      throw new BrowserError("Aborted", "CDP command cancelled before sending", commandContext);
    return new Promise((resolve, reject) => {
      const cancel = () =>
        finish(
          id,
          new BrowserError("Aborted", "CDP command cancelled; browser outcome is unknown", {
            ...commandContext,
            requestId: id,
            outcome: "unknown",
            cause: command.signal?.reason,
          }),
        );
      const timer = setTimeout(
        () =>
          finish(
            id,
            new BrowserError(
              "Timeout",
              "CDP command deadline expired; browser outcome is unknown",
              {
                ...commandContext,
                requestId: id,
                outcome: "unknown",
              },
            ),
          ),
        timeout,
      );
      pending.set(id, {
        method,
        sessionId: command.sessionId,
        resolve,
        reject,
        cleanup: () => {
          clearTimeout(timer);
          command.signal?.removeEventListener("abort", cancel);
        },
      });
      command.signal?.addEventListener("abort", cancel, { once: true });
      try {
        transport!.write(payload);
      } catch (cause) {
        failedTransport(cause);
      }
    });
  };
  const client: CdpClient = {
    async send<M extends keyof ProtocolMapping.Commands>(
      method: M,
      ...params: ProtocolMapping.Commands[M]["paramsType"]
    ): Promise<ProtocolMapping.Commands[M]["returnType"]> {
      return (await sendRaw(
        method,
        params[0] as Record<string, unknown> | undefined,
      )) as ProtocolMapping.Commands[M]["returnType"];
    },
    sendRaw,
    subscribe: (listener) => {
      if (closed)
        throw new BrowserError("Closed", "Cannot subscribe to a closed CDP client", {
          ...context,
          outcome: "not-sent",
        });
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close: async () =>
      shutdown(
        new BrowserError("Closed", "CDP client closed", { ...context, outcome: "not-sent" }),
      ),
  };
  const opened = () => {
    if (closed) return;
    ready = true;
    cleanupAcquisition();
    resolveConnection(client);
  };
  const abortConnection = () =>
    shutdown(
      new BrowserError("Aborted", "CDP connection cancelled", {
        ...context,
        outcome: "not-sent",
        cause: options.signal?.reason,
      }),
    );
  const connectionTimer = setTimeout(
    () =>
      shutdown(
        new BrowserError("Timeout", "CDP connection deadline expired", {
          ...context,
          outcome: "not-sent",
        }),
      ),
    timeoutMs,
  );
  options.signal?.addEventListener("abort", abortConnection, { once: true });
  try {
    if (typeof endpoint === "string") {
      const url = new URL(endpoint);
      if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Expected a ws:// or wss:// CDP URL without credentials");
      }
      const socket = new WebSocket(url, {
        handshakeTimeout: timeoutMs,
        maxPayload: MAX_FRAME,
        perMessageDeflate: false,
      });
      const onMessage = (data: WebSocket.RawData, binary: boolean) => {
        if (binary)
          return shutdown(
            new BrowserError("InvalidResponse", "CDP WebSocket frame must be text", {
              ...context,
              outcome: "unknown",
            }),
          );
        const bytes = Buffer.isBuffer(data)
          ? data
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.concat(data);
        receive(bytes.toString("utf8"));
      };
      socket.once("open", opened);
      socket.on("message", onMessage);
      socket.on("error", failedTransport);
      socket.once("close", failedTransport);
      transport = {
        write: (payload) =>
          socket.send(payload, (error) => {
            if (error) failedTransport(error);
          }),
        close: () => {
          socket.removeListener("open", opened);
          socket.removeListener("message", onMessage);
          socket.removeListener("close", failedTransport);
          // Keep the error handler through terminate: a connecting socket emits error asynchronously.
          socket.once("close", () => socket.removeListener("error", failedTransport));
          socket.terminate();
        },
      };
    } else {
      let buffer = Buffer.alloc(0);
      const onData = (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        let start = 0;
        for (let end = bytes.indexOf(0); end >= 0; end = bytes.indexOf(0, start)) {
          const frame = Buffer.concat([buffer, bytes.subarray(start, end)]);
          if (frame.length > MAX_FRAME)
            return failedTransport(new Error("CDP pipe frame exceeds size limit"));
          buffer = Buffer.alloc(0);
          if (frame.length) receive(frame.toString("utf8"));
          if (closed) return;
          start = end + 1;
        }
        buffer = Buffer.concat([buffer, bytes.subarray(start)]);
        if (buffer.length > MAX_FRAME)
          failedTransport(new Error("CDP pipe frame exceeds size limit"));
      };
      const { readable, writable } = endpoint;
      transport = {
        write: (payload) => {
          if (!writable.writable) throw new Error("CDP pipe is not writable");
          writable.write(`${payload}\0`, (error?: Error | null) => {
            if (error) failedTransport(error);
          });
        },
        close: () => {
          readable.removeListener("data", onData);
          readable.removeListener("end", failedTransport);
          readable.removeListener("close", failedTransport);
          writable.removeListener("close", failedTransport);
          // Dedicated pipe ends belong to this client; ending them is not process cleanup proof.
          writable.end();
          if ("destroy" in readable && typeof readable.destroy === "function") readable.destroy();
          if ("destroy" in writable && typeof writable.destroy === "function") writable.destroy();
          buffer = Buffer.alloc(0);
          for (const stream of [readable, writable]) {
            stream.once("close", () => stream.removeListener("error", failedTransport));
          }
        },
      };
      readable.on("data", onData);
      readable.once("end", failedTransport);
      readable.once("close", failedTransport);
      readable.on("error", failedTransport);
      writable.once("close", failedTransport);
      writable.on("error", failedTransport);
      if (!readable.readable || !writable.writable)
        failedTransport(new Error("CDP pipe is already closed"));
      else opened();
    }
  } catch (cause) {
    failedTransport(cause);
  }
  return connected;
}

export function connectCdp(
  endpoint: string | PipeEndpoint,
  options?: ConnectOptions,
): Promise<CdpClient> {
  return acquireClient(endpoint, options);
}

function typedError(cause: unknown): BrowserError {
  return cause instanceof BrowserError
    ? cause
    : new BrowserError("ConnectionFailed", "CDP operation failed", { cause });
}

/** Scope closes the connection and every pending command/subscription; acquisition is interruptible. */
export function connectCdpEffect(
  endpoint: string | PipeEndpoint,
  options: ConnectOptions = {},
): Effect.Effect<CdpClient, BrowserError, Scope.Scope> {
  return Effect.gen(function* () {
    let acquired: CdpClient | undefined;
    // Install ownership before starting I/O, including interruption at the Promise handoff.
    const lifetime = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) =>
        Effect.promise(async () => {
          controller.abort();
          await acquired?.close();
        }),
    );
    return yield* Effect.tryPromise({
      try: (signal) =>
        acquireClient(endpoint, {
          ...options,
          signal: AbortSignal.any([
            signal,
            lifetime.signal,
            ...(options.signal ? [options.signal] : []),
          ]),
        }).then((client) => {
          acquired = client;
          if (lifetime.signal.aborted || signal.aborted) {
            void client.close();
            throw new BrowserError("Aborted", "CDP acquisition interrupted", {
              outcome: "not-sent",
            });
          }
          return client;
        }),
      catch: typedError,
    });
  });
}

export function sendCdpEffect(
  client: CdpClient,
  method: string,
  params?: Record<string, unknown>,
  options: CommandOptions = {},
): Effect.Effect<unknown, BrowserError> {
  return Effect.tryPromise({
    try: (signal) =>
      client.sendRaw(method, params, {
        ...options,
        signal: options.signal ? AbortSignal.any([signal, options.signal]) : signal,
      }),
    catch: typedError,
  });
}

export function subscribeCdpEffect(
  client: CdpClient,
  listener: (event: CdpEvent) => void,
): Effect.Effect<() => void, BrowserError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.try({ try: () => client.subscribe(listener), catch: typedError }),
    (unsubscribe) => Effect.sync(unsubscribe),
  );
}
