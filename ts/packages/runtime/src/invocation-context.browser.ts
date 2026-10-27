/// <reference lib="dom" />
/// <reference types="vite-plus/client" />
import { HOST_RUNTIME_SERVICE_HEADER } from "@pe/host-contracts/contracts";
import type { ActionAdmission, Caller } from "@pe/agent-contracts";

export type RequestPrincipal =
  | { readonly kind: "local" }
  | {
      readonly kind: "remote";
      readonly transport: "lan" | "ssh";
      readonly authority: string;
      readonly login?: string;
    }
  | { readonly kind: "tailnet"; readonly login: string; readonly authority: string };

export interface InvocationContext {
  readonly hostBaseUrl?: string;
  readonly beforeTool?: (name: string) => Promise<void>;
  readonly principal?: RequestPrincipal;
  /** The host-minted caller of the request this context serves (host side only). */
  readonly caller?: Caller;
  readonly device?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly admissions?: Map<string, ActionAdmission>;
  readonly running?: Map<string, string>;
}

// Frozen into the served page's module graph by the web build, like `host/runtime.ts`.
const serviceName = import.meta.env.PE_RUNTIME_SERVICE;

// Browser clients already have a single user and same-origin transport, with no ambient tool scope.
export const invocationContext = (): InvocationContext | undefined => undefined;
export const carriesCallerContext = (): boolean => false;

/**
 * The page's own origin only, carrying the runtime owner the host's identity gate requires of
 * every browser API call (and without which the host cannot read a request as the web app's).
 */
export const contextFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (!serviceName || url.origin !== location.origin) return globalThis.fetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  headers.set(HOST_RUNTIME_SERVICE_HEADER, serviceName);
  return globalThis.fetch(input, { ...init, headers });
};
