import { PeHostClient, type PeHostClientOptions } from "./host-client.js";
import {
  hostProcessIdentity,
  scriptingWorkspaceIdentity,
} from "./generated/product.generated.js";

export const defaultHostBaseUrl = hostProcessIdentity.defaultHostBaseUrl;
export const defaultWorkspaceKey = scriptingWorkspaceIdentity.defaultWorkspaceKey;

export function resolveHostBaseUrl(value?: string): string {
  return firstNonBlank(value, process.env[hostProcessIdentity.hostBaseUrlVariable]) ?? defaultHostBaseUrl;
}

export function resolveWorkspaceKey(value?: string): string {
  return firstNonBlank(value) ?? defaultWorkspaceKey;
}

export function createPeHostClient(
  hostBaseUrl?: string,
  options: Omit<PeHostClientOptions, "baseUrl"> = {},
): PeHostClient {
  return new PeHostClient({ ...options, baseUrl: resolveHostBaseUrl(hostBaseUrl) });
}

function firstNonBlank(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value != null && value.trim().length > 0)?.trim();
}
