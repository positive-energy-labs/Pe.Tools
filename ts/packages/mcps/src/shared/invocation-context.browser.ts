import type { ActionAdmission } from "@pe/agent-contracts";

export type RequestPrincipal =
  | { readonly kind: "local" }
  | { readonly kind: "tailnet"; readonly login: string; readonly authority: string };

export interface InvocationContext {
  readonly hostBaseUrl?: string;
  readonly beforeTool?: (name: string) => Promise<void>;
  readonly thread?: string;
  readonly principal?: RequestPrincipal;
  readonly headers?: Readonly<Record<string, string>>;
  readonly admissions?: Map<string, ActionAdmission>;
  readonly running?: Map<string, string>;
}

// Browser clients already have a single user and same-origin transport, with no ambient tool scope.
export const invocationContext = (): InvocationContext | undefined => undefined;
export const contextFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
