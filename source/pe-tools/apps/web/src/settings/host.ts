import type { PodMember, SettingsSnapshot } from "@pe/agent-contracts";

import { podHost } from "#/route/pods";

/** A member as the settings Work reads it: the saved bytes, and what the host made of them. */
export async function openMember(member: PodMember): Promise<SettingsSnapshot> {
  const { content, sha256 } = await podHost.read(member);
  const composed = await podHost.compose(member, content);
  return {
    member,
    sha256,
    observedAt: new Date().toISOString(),
    rawContent: content,
    composedContent: composed.composed,
    dependencies: [...composed.dependencies],
    validation: {
      isValid: !composed.diagnostics.some((issue) => issue.severity === "error"),
      issues: composed.diagnostics.map((issue) => ({ ...issue })),
    },
  };
}
