import {
  collectPostLiveCommandHooks,
  defaultPeaRuntimeTimeoutSeconds,
} from "../shared/pea-runtime-hooks.ts";
import { runSdkLiveSync } from "./sdk-live.js";

export interface LiveRrdSyncOptions {
  timeoutSeconds?: number;
  project?: string;
  revitYear?: string;
  includePeaStatus?: boolean;
  logTail?: number;
  resetLogCursor?: boolean;
  hostBaseUrl?: string;
}

export async function syncLiveRrd(options: LiveRrdSyncOptions = {}) {
  const sync = await runSdkLiveSync({
    timeoutSeconds: options.timeoutSeconds ?? defaultPeaRuntimeTimeoutSeconds,
    project: options.project,
    revitYear: options.revitYear,
  });

  const hooks = await collectPostLiveCommandHooks({
    includePeaStatus: options.includePeaStatus ?? true,
    logTail: options.logTail ?? 20,
    resetLogCursor: options.resetLogCursor ?? false,
    hostBaseUrl: options.hostBaseUrl,
  });

  return {
    ...sync,
    json: {
      ...(isRecord(sync.json) ? sync.json : { sdkLive: sync.json }),
      hooks,
    },
    stdoutTail: JSON.stringify(
      {
        sdkLive: isRecord(sync.json) ? sync.json : sync.stdoutTail,
        hooks,
      },
      null,
      2,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
