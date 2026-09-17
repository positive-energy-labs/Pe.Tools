/**
 * The typed host-local pod reads. The host owns member I/O so the web works offline; `route/pods.ts`
 * turns these into the route layer's pod port and the `pods` Reading.
 */
import type { MemberRef } from "#/route/manifest";

import { callHostRpc } from "./client";

export const listPods = async () => [...(await callHostRpc("pod.list")).pods];

export const readMember = (ref: MemberRef) => callHostRpc("pod.member.read", ref);

export const composeMember = (ref: MemberRef, content?: string) =>
  callHostRpc("pod.member.compose", { ...ref, ...(content === undefined ? {} : { content }) });
