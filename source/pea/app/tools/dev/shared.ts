import { createPeHostClient, resolveHostBaseUrl } from "../../pe-host.js";

const defaultHostContextTimeoutMs = 5_000;

export async function collectHostContext(options: { timeoutMs?: number } = {}) {
  const hostBaseUrl = resolveHostBaseUrl();
  const hostClient = createPeHostClient(hostBaseUrl, {
    timeoutMs: options.timeoutMs ?? defaultHostContextTimeoutMs,
  });
  const [probeResult, sessionResult] = await Promise.allSettled([
    hostClient.host.getProbe(),
    hostClient.host.getSessionSummary(),
  ]);

  return {
    reachable:
      probeResult.status === "fulfilled" ||
      sessionResult.status === "fulfilled",
    probe:
      probeResult.status === "fulfilled"
        ? {
            bridgeIsConnected: probeResult.value.bridgeIsConnected,
            bridgePath: probeResult.value.bridgePath,
            disconnectReason: probeResult.value.disconnectReason,
            runtimeIdentity: probeResult.value.runtimeIdentity,
            hostContractVersion: probeResult.value.hostContractVersion,
            bridgeContractVersion: probeResult.value.bridgeContractVersion,
          }
        : { error: formatUnknownError(probeResult.reason) },
    session:
      sessionResult.status === "fulfilled"
        ? {
            bridgeIsConnected: sessionResult.value.bridgeIsConnected,
            sessionId: sessionResult.value.sessionId,
            processId: sessionResult.value.processId,
            revitVersion: sessionResult.value.revitVersion,
            openDocumentCount: sessionResult.value.openDocumentCount,
            availableModuleCount: sessionResult.value.availableModules?.length,
            activeDocument:
              sessionResult.value.activeDocument == null
                ? null
                : {
                    title: sessionResult.value.activeDocument.title,
                    key: sessionResult.value.activeDocument.key,
                    isFamilyDocument:
                      sessionResult.value.activeDocument.isFamilyDocument,
                    isWorkshared:
                      sessionResult.value.activeDocument.isWorkshared,
                    isModelInCloud:
                      sessionResult.value.activeDocument.isModelInCloud,
                  },
          }
        : { error: formatUnknownError(sessionResult.reason) },
  };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
