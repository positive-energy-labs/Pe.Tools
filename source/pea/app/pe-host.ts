import { PeHostClient } from "./generated/pe-host-client.js";

export const defaultHostBaseUrl = "http://localhost:5180";
export const defaultWorkspaceKey = "default";

export function resolveHostBaseUrl(value?: string): string {
  return firstNonBlank(value, process.env.PE_TOOLS_HOST_BASE_URL) ?? defaultHostBaseUrl;
}

export function resolveWorkspaceKey(value?: string): string {
  return firstNonBlank(value) ?? defaultWorkspaceKey;
}

export function createPeHostClient(hostBaseUrl?: string): PeHostClient {
  return new PeHostClient({ baseUrl: resolveHostBaseUrl(hostBaseUrl) });
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0)?.trim();
}
