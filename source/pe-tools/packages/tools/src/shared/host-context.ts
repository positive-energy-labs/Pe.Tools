import { PeHostClient, type HostActiveDocumentSummary } from "@pe/host-client";

const defaultHostContextTimeoutMs = 5_000;

export async function collectHostContext(
  options: { hostBaseUrl?: string; timeoutMs?: number } = {},
) {
  const hostBaseUrl = PeHostClient.resolveHostBaseUrl(options.hostBaseUrl);
  const hostClient = new PeHostClient({
    baseUrl: hostBaseUrl,
    timeoutMs: options.timeoutMs ?? defaultHostContextTimeoutMs,
  });
  const [probeResult, sessionResult] = await Promise.allSettled([
    hostClient.host.getProbe(),
    hostClient.host.getSessionSummary(),
  ]);

  return {
    reachable: probeResult.status === "fulfilled" || sessionResult.status === "fulfilled",
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
                : summarizeActiveDocument(sessionResult.value.activeDocument),
          }
        : { error: formatUnknownError(sessionResult.reason) },
  };
}

function summarizeActiveDocument(activeDocument: HostActiveDocumentSummary) {
  return {
    title: activeDocument.title,
    key: activeDocument.key,
    path: activeDocument.path,
    identityKind: activeDocument.isModelInCloud
      ? "cloud"
      : activeDocument.path
        ? "path"
        : "unsaved",
    isFamilyDocument: activeDocument.isFamilyDocument,
    isWorkshared: activeDocument.isWorkshared,
    isModelInCloud: activeDocument.isModelInCloud,
    cloudProjectGuid: activeDocument.cloudProjectGuid,
    cloudModelGuid: activeDocument.cloudModelGuid,
    cloudModelUrn: activeDocument.cloudModelUrn,
    observedAtUnixMs: activeDocument.observedAtUnixMs,
  };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
