import {
  memberWork,
  podMemberSchema,
  settingsCandidate,
  type PodMember,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";
import type { Composed, PodRow } from "#/route/pods";
import type { ReadingScope, ReadingState } from "#/shell/readings";
import { DEMO_PODS, DEMO_SPEC_PATH } from "#/route/seeds";
import { DEMO_MEMBER_SPECS } from "./seeds";
import type { PodsPage } from "./page";

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
export const readingValue = <T>(state: ReadingState | undefined): T | null =>
  (state?.value ?? state?.previous ?? null) as T | null;
export const fixturePage = (page: Readonly<PodsPage>) => !!page.demo && page.live === undefined;
export function selectedMember(page: Readonly<PodsPage>): PodMember | null {
  const selected =
    fixturePage(page) && !page.pod
      ? { pod: DEMO_PODS[0]!.id, path: DEMO_SPEC_PATH }
      : { pod: page.pod, path: page.path };
  const parsed = podMemberSchema.safeParse(selected);
  return parsed.success ? parsed.data : null;
}
export const sameMember = (a: PodMember | null | undefined, b: PodMember | null | undefined) =>
  !!a && !!b && a.pod === b.pod && a.path === b.path;
export const selectedRow = (page: PodsPage, pods: readonly PodRow[]) => {
  const ref = selectedMember(page);
  const pod = pods.find((row) => row.id === ref?.pod);
  const member = pod?.members.find((row) => row.path === ref?.path);
  return { pod, member, ref };
};
export function draftOf(
  scope: Pick<ReadingScope<PodsPage, SettingsRouteDocument>, "page" | "work">,
  read: MemberRead | null,
) {
  const ref = selectedMember(scope.page);
  if (fixturePage(scope.page))
    return ref ? (DEMO_MEMBER_SPECS.get(`${ref.pod}|${ref.path}`)?.content ?? "") : "";
  const basis = scope.work?.basis;
  return sameMember(basis?.member, ref)
    ? settingsCandidate(basis!.rawContent, scope.work!.fields)
    : sameMember(read?.member, ref)
      ? read!.content
      : "";
}
export const workSubject = (page: Readonly<PodsPage>) => {
  const member = selectedMember(page);
  return member && member.path.endsWith(".json") && !fixturePage(page) ? memberWork(member) : "";
};
export const siblingPath = (path: string, at = new Date()) =>
  path.replace(/(\.json)?$/, `.${at.toISOString().replace(/[:.]/g, "-")}.json`);
