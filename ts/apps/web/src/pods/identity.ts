import { memberWork, parseContributionKey, type PodMember } from "@pe/agent-contracts";
import { identityCodecs } from "../../../../packages/agent-contracts/src/route-kernel-codecs.ts";
export function memberId(member: PodMember) {
  const result = identityCodecs.local.encode({ namespace: "pods", subject: memberWork(member) });
  if (!result.ok) throw Error(result.reason);
  return result.value;
}
export function memberOf(id: string | null | undefined): PodMember | null {
  if (!id) return null;
  const decoded = identityCodecs.local.decode(id);
  if (!decoded.ok) return null;
  const parts = identityCodecs.local.parts(decoded.value);
  const member = parseContributionKey(parts.subject);
  return parts.namespace === "pods" && member?.kind === "member"
    ? { pod: member.packageId, path: member.path }
    : null;
}
