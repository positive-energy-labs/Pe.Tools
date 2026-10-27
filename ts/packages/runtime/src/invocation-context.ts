import { AsyncLocalStorage } from "node:async_hooks";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  HOST_CONTEXT_HEADER,
  HOST_CONTEXT_VARIABLE,
  HOST_RUNTIME_SERVICE_HEADER,
} from "@pe/host-contracts/contracts";
import { resolveLaneAndRoot } from "./runtime-owner.ts";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { productRoot } from "@pe/host-contracts/service-identity";
import type { InvocationContext } from "./invocation-context.browser.ts";
export type {
  InvocationContext,
  RequestPrincipal,
  InvocationRecord,
} from "./invocation-context.browser.ts";
import type { InvocationRecord } from "./invocation-context.browser.ts";

const context = new AsyncLocalStorage<InvocationContext>();
export const invocationContext = () => context.getStore();
export const withInvocationContext = <T>(value: InvocationContext, run: () => T): T => {
  const headers = new Headers(value.headers);
  const token = process.env[HOST_CONTEXT_VARIABLE]?.trim();
  if (token && !headers.has(HOST_CONTEXT_HEADER)) headers.set(HOST_CONTEXT_HEADER, token);
  // Capture transport identity before async tool/process entry; retain live caller capabilities.
  return context.run({ ...value, headers: Object.freeze(Object.fromEntries(headers)) }, run);
};

function capturedContextHash() {
  const held = invocationContext();
  const identity =
    (held
      ? new Headers(held.headers).get(HOST_CONTEXT_HEADER)
      : process.env[HOST_CONTEXT_VARIABLE]?.trim()) || "human";
  return createHash("sha256").update(identity).digest("hex");
}
function outboxPath(slot: string) {
  // The caller's slot already includes the host base. A new root must find old pending intent.
  const hash = createHash("sha256").update(slot).digest("hex");
  return join(
    productRoot(),
    "state",
    resolveLaneAndRoot().serviceName,
    "invocation-outbox",
    `${hash}.json`,
  );
}
export function readOutbox(slot: string): InvocationRecord | undefined {
  try {
    const { contextHash, ...record } = JSON.parse(
      readFileSync(outboxPath(slot), "utf8"),
    ) as InvocationRecord & { contextHash?: string };
    if (record.admission && contextHash !== capturedContextHash())
      throw Error(
        `Unacknowledged action '${record.id}' belongs to a different or unproven captured caller context; its original bytes remain retained`,
      );
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
export function writeOutbox(slot: string, value?: InvocationRecord): void {
  const path = outboxPath(slot);
  // Clearing or acknowledging pending bytes cannot transfer their original causal authority.
  readOutbox(slot);
  if (!value) {
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return;
  }
  mkdirSync(join(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(
    temp,
    JSON.stringify(value.admission ? { ...value, contextHash: capturedContextHash() } : value),
  );
  renameSync(temp, path);
}

/** Node fetch drops Host. Internal proxy requests must retain the verified authority on the wire. */
export const hostFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  if (!request.headers.has("host")) return globalThis.fetch(input, init);
  if (new URL(request.url).protocol !== "http:")
    throw Error("Host forwarding requires an HTTP backend.");
  return new Promise<Response>((resolve, reject) => {
    const outgoing = httpRequest(
      request.url,
      {
        method: request.method,
        headers: Object.fromEntries(request.headers),
        signal: request.signal,
      },
      (incoming) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (Array.isArray(value)) value.forEach((part) => headers.append(key, part));
          else if (value !== undefined) headers.set(key, value);
        }
        const status = incoming.statusCode!;
        const empty = request.method === "HEAD" || [204, 205, 304].includes(status);
        if (empty) incoming.resume();
        resolve(
          new Response(empty ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>), {
            status,
            headers,
            statusText: incoming.statusMessage,
          }),
        );
      },
    );
    outgoing.on("error", reject);
    if (request.body)
      void pipeline(Readable.fromWeb(request.body as never), outgoing).catch(reject);
    else outgoing.end();
  });
};

/** Forward only to the bound host. External docs/assets never receive operator identity. */
export const contextFetch: typeof fetch = (input, init) => {
  const held = invocationContext();
  const address = input instanceof Request ? input.url : String(input);
  const url = held?.hostBaseUrl ? new URL(address, held.hostBaseUrl) : URL.parse(address);
  if (
    !url ||
    (held?.hostBaseUrl
      ? url.origin !== new URL(held.hostBaseUrl).origin
      : url.hostname !== "127.0.0.1")
  )
    return globalThis.fetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  for (const [key, value] of Object.entries(held?.headers ?? {})) headers.set(key, value);
  headers.set(HOST_RUNTIME_SERVICE_HEADER, resolveLaneAndRoot().serviceName);
  carryContext(headers);
  return hostFetch(input, { ...init, headers });
};

/** Whether a host call from here carries a caller context, and so may have a thread of its own. */
export const carriesCallerContext = (): boolean =>
  invocationContext()
    ? new Headers(invocationContext()!.headers).has(HOST_CONTEXT_HEADER)
    : Boolean(process.env[HOST_CONTEXT_VARIABLE]?.trim());

/** This process's caller context (a harness child's, or the owner's terminal's) rides every host call. */
function carryContext(headers: Headers) {
  if (invocationContext()) return;
  const token = process.env[HOST_CONTEXT_VARIABLE]?.trim();
  if (token && !headers.has(HOST_CONTEXT_HEADER)) headers.set(HOST_CONTEXT_HEADER, token);
}
