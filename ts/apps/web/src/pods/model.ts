import {
  podMemberSchema,
  settingsCandidate,
  type PodMember,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import type { Composed, PodRow } from "../route/pods.ts";
import type { PodsPage } from "./page.ts";

export interface MemberRead {
  member: PodMember;
  content: string;
  sha256: string;
  schemaJson?: string;
}
export interface CompositionRead {
  member: PodMember;
  draft: string;
  result: Composed;
}
export const readingValue = <T>(
  state: { value?: unknown; previous?: unknown } | undefined,
): T | null => (state?.value ?? state?.previous ?? null) as T | null;
export function selectedMember(page: Readonly<Pick<PodsPage, "pod" | "path">>): PodMember | null {
  const selected = { pod: page.pod, path: page.path };
  const parsed = podMemberSchema.safeParse(selected);
  return parsed.success ? parsed.data : null;
}
export const sameMember = (a: PodMember | null | undefined, b: PodMember | null | undefined) =>
  !!a && !!b && a.pod === b.pod && a.path === b.path;
export const selectedRow = (page: Pick<PodsPage, "pod" | "path">, pods: readonly PodRow[]) => {
  const ref = selectedMember(page);
  const pod = pods.find((row) => row.id === ref?.pod);
  const member = pod?.members.find((row) => row.path === ref?.path);
  return { pod, member, ref };
};
export function draftOf(
  scope: {
    page: Readonly<Pick<PodsPage, "pod" | "path">>;
    work: Readonly<SettingsRouteDocument> | null;
  },
  read: MemberRead | null,
) {
  const ref = selectedMember(scope.page);
  const basis = scope.work?.basis;
  return sameMember(basis?.member, ref)
    ? settingsCandidate(basis!.rawContent, scope.work!.fields)
    : sameMember(read?.member, ref)
      ? read!.content
      : "";
}
// Pure intents use the mount-issued press instead of sampling time; the host still refuses overwrite.
export const siblingPath = (path: string, press: string) =>
  path.replace(/(\.json)?$/, `.${press}.json`);
