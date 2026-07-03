import { hostProcessIdentity, scriptingWorkspaceIdentity } from "@pe/host-contracts/contracts";
import { firstNonBlank } from "./cli-values.ts";

export function resolveHostBaseUrl(value?: string): string {
  return (
    firstNonBlank(value, process.env[hostProcessIdentity.hostBaseUrlVariable]) ??
    hostProcessIdentity.defaultHostBaseUrl
  );
}

export function resolveWorkspaceKey(value?: string): string {
  return firstNonBlank(value) ?? scriptingWorkspaceIdentity.defaultWorkspaceKey;
}
