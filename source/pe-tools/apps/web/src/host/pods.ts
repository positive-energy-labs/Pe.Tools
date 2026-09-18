/**
 * The typed host-local pod reads. The host owns member I/O so the web works offline; `route/pods.ts`
 * turns these into the route layer's pod port and the `pods` Reading.
 */
import type { MemberRef } from "#/route/manifest";

import { callHostRpc } from "./client";

export const listPods = async () => [...(await callHostRpc("pod.list")).pods];

export const readMember = (ref: MemberRef) => callHostRpc("pod.member.read", ref);

/** One pod's run receipts, newest first; `path` narrows to the member a route has open. */
export const listRuns = async (pod: string, path?: string) => [
  ...(await callHostRpc("pod.runs", path === undefined ? { pod } : { pod, path })).runs,
];

export const composeMember = (ref: MemberRef, content?: string) =>
  callHostRpc("pod.member.compose", { ...ref, ...(content === undefined ? {} : { content }) });
