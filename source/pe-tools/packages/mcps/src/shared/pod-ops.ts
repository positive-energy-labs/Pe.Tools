// SHIM: deleted at graft when host-ops.generated.ts carries pod.*; callers then use HostRpcCaller.call directly.
import type { PodMember } from "@pe/agent-contracts";
import type { HostRpcCaller } from "./host-rpc-caller.ts";

export type PodDiagnostic = { path?: string | null; message: string; severity?: string | null };
export type PodSummary = {
  id: string;
  name: string;
  version: string;
  folder: string;
  entrypoints: { id: string; sourcePath: string; name?: string; description?: string }[];
  members: { path: string; sha256: string; schema?: string | null }[];
  diagnostics: PodDiagnostic[];
};

type PodOps = {
  "pod.list": { request: Record<string, never>; response: { pods: PodSummary[] } };
  "pod.import": { request: { archivePath: string }; response: { pod: string; folder: string } };
  "pod.export": { request: { pod: string }; response: { archivePath: string } };
  "pod.member.read": { request: PodMember; response: { content: string; sha256: string } };
  "pod.member.compose": {
    request: PodMember & { content?: string };
    response: {
      composed: string;
      diagnostics: PodDiagnostic[];
      dependencies: { id: string; path: string; sha256: string }[];
    };
  };
};
export type PodOpResponse<K extends keyof PodOps> = PodOps[K]["response"];

export function callPodOp<K extends keyof PodOps>(
  caller: HostRpcCaller,
  key: K,
  request: PodOps[K]["request"],
): Promise<PodOpResponse<K>> {
  return caller.call(key as never, request as never) as Promise<PodOpResponse<K>>;
}
