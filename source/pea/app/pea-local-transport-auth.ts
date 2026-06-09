import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export interface PeaLocalTransportAuth {
  token: string;
  isAuthorized(request: IncomingMessage, url: URL): boolean;
}

export interface PeaLocalTransportAuthOptions {
  token?: string;
  headerNames?: string[];
  queryParameter?: string;
}

const defaultQueryParameter = "token";

export function createPeaLocalTransportAuth(
  options: PeaLocalTransportAuthOptions = {},
): PeaLocalTransportAuth {
  const token = options.token ?? randomBytes(24).toString("base64url");
  const headerNames = (options.headerNames ?? ["x-pea-local-token"]).map((name) =>
    name.toLowerCase(),
  );
  const queryParameter = options.queryParameter ?? defaultQueryParameter;

  return {
    token,
    isAuthorized(request, url) {
      const candidate =
        bearerToken(request.headers.authorization) ??
        url.searchParams.get(queryParameter) ??
        firstHeaderValue(request, headerNames);
      return typeof candidate === "string" && constantTimeEquals(candidate, token);
    },
  };
}

export function bearerToken(value: string | undefined): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(value ?? "");
  return match?.[1];
}

export function constantTimeEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function firstHeaderValue(request: IncomingMessage, headerNames: string[]): string | undefined {
  for (const headerName of headerNames) {
    const value = request.headers[headerName];
    if (typeof value === "string") return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}
