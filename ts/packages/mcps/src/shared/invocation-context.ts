import { AsyncLocalStorage } from "node:async_hooks";
import { request as httpRequest } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { InvocationContext } from "./invocation-context.browser.ts";
export type { InvocationContext, RequestPrincipal } from "./invocation-context.browser.ts";

const context = new AsyncLocalStorage<InvocationContext>();
export const invocationContext = () => context.getStore();
export const withInvocationContext = <T>(value: InvocationContext, run: () => T): T =>
  context.run(value, run);

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
  if (!held?.hostBaseUrl) return globalThis.fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input), held?.hostBaseUrl);
  if (url.origin !== new URL(held.hostBaseUrl).origin) return globalThis.fetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  for (const [key, value] of Object.entries(held.headers ?? {})) headers.set(key, value);
  return hostFetch(input, { ...init, headers });
};
