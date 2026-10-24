export type BrowserOutcome = "not-sent" | "unknown" | "rejected";

export interface BrowserErrorContext {
  method?: string;
  requestId?: number | string;
  sessionId?: string;
  endpoint?: string;
  outcome?: BrowserOutcome;
  protocolCode?: number;
  data?: unknown;
  cause?: unknown;
}

/** `unknown` means Chrome may have acted; callers must inspect state, never replay blindly. */
export class BrowserError extends Error {
  readonly _tag = "BrowserError";
  readonly code: string;
  readonly method?: string;
  readonly requestId?: number | string;
  readonly sessionId?: string;
  readonly endpoint?: string;
  readonly outcome?: BrowserOutcome;
  readonly protocolCode?: number;
  readonly data?: unknown;

  constructor(code: string, message: string, context: BrowserErrorContext = {}) {
    super(message, { cause: context.cause });
    this.name = "BrowserError";
    this.code = code;
    this.method = context.method;
    this.requestId = context.requestId;
    this.sessionId = context.sessionId;
    this.endpoint = context.endpoint;
    this.outcome = context.outcome;
    this.protocolCode = context.protocolCode;
    this.data = context.data;
  }
}
