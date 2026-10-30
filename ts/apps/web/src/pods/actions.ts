import { memberWork, parseContributionKey, type SettingsRouteDocument } from "@pe/agent-contracts";
import type { BindingScope } from "#/shell/mount-owner";
import type { PodsPage } from "./page";
import {
  draftOf,
  fixturePage,
  readingValue,
  sameMember,
  selectedMember,
  siblingPath,
  workSubject,
  type MemberRead,
  type CompositionRead,
} from "./model";
import type { PluginsRead } from "./sources";

export type PodsScope = BindingScope<PodsPage, SettingsRouteDocument>;
export function memberWorkRefusal(scope: PodsScope) {
  const ref = selectedMember(scope.page);
  if (fixturePage(scope.page)) return "The demo member is read-only.";
  if (!ref || !ref.path.endsWith(".json")) return "Pick a JSON member first.";
  return !scope.work || scope.work.handle.key.work !== memberWork(ref)
    ? "Select this member's Work first."
    : null;
}
export function editRefusal(scope: PodsScope) {
  const blocked = memberWorkRefusal(scope);
  if (blocked) return blocked;
  const read = readingValue<MemberRead>(scope.readings.member);
  const basis = scope.work?.doc.basis;
  return !basis || !sameMember(basis.member, selectedMember(scope.page))
    ? "Open the saved member's bytes first."
    : !scope.readings.member?.current || !sameMember(read?.member, basis.member)
      ? "Wait for the current saved member bytes."
      : read?.sha256 !== basis.sha256
        ? "The member changed on disk; adopt its new bytes before editing."
        : null;
}
export function saveRefusal(scope: PodsScope) {
  const blocked = editRefusal(scope);
  if (blocked) return blocked;
  if (scope.page.pendingDraft) return "The draft is still being edited on the member.";
  try {
    const draft = draftOf(
      { page: scope.page, work: scope.work!.doc },
      readingValue<MemberRead>(scope.readings.member),
    );
    const value: unknown = JSON.parse(draft);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return "A spec is a JSON object.";
    if (!Object.values(scope.work!.doc.fields).some((field) => field.edit))
      return "Nothing to save.";
    const composed = readingValue<CompositionRead>(scope.readings.composition);
    if (
      !scope.readings.composition?.current ||
      !sameMember(composed?.member, selectedMember(scope.page)) ||
      composed?.draft !== draft
    )
      return "The host is still checking this draft.";
    const errors = composed.result.diagnostics.filter((issue) => issue.severity === "error");
    return errors.length
      ? `The host called this draft invalid: ${errors[0]!.path || "the member"}: ${errors[0]!.message}`
      : null;
  } catch (error) {
    return `The draft is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
}
export function podsBinding(id: string, row: unknown, scope: PodsScope) {
  const args = (row ?? {}) as Record<string, unknown>;
  const ref = selectedMember(scope.page);
  if (id === "select") return { subject: null, args: ref && !row ? ref : args };
  if (id === "open" || id === "adopt") {
    const read = readingValue<MemberRead>(scope.readings.member);
    return {
      subject: null,
      args: {
        member: ref,
        sha256: read?.sha256,
        refusal:
          memberWorkRefusal(scope) ??
          (!scope.readings.member?.current || !sameMember(read?.member, ref)
            ? "Wait for the current saved member bytes."
            : id === "open" && scope.work?.doc.basis
              ? "This member already has a Work basis."
              : id === "adopt" &&
                  (!scope.work?.doc.basis || scope.work.doc.basis.sha256 === read?.sha256)
                ? "These are already the adopted bytes."
                : null),
      },
    };
  }
  if (id === "edit") return { subject: null, args: { ...args, refusal: editRefusal(scope) } };
  if (id === "save" || id === "save-new")
    return {
      subject: null,
      args: {
        ...(id === "save-new" &&
          ref && { destination: { pod: ref.pod, path: siblingPath(ref.path) } }),
        refusal: saveRefusal(scope),
      },
    };
  if (id === "activation") {
    const plugins = readingValue<PluginsRead>(scope.readings.plugins);
    const plugin = plugins?.statuses.find((status) => status.id === args.id);
    return {
      subject: null,
      args: {
        ...args,
        refusal: fixturePage(scope.page)
          ? "Demo activation is read-only."
          : !scope.readings.plugins?.current
            ? "Reading this Pod's activation."
            : !plugin
              ? "This host lists no activation for this Pod."
              : plugin.status === "error"
                ? (plugin.error ?? "This Pod failed to activate.")
                : null,
      },
    };
  }
  return { subject: null, args };
}

export function podsCell(row: unknown, scope: PodsScope) {
  const key = (row as { key?: string } | undefined)?.key;
  return key !== undefined && scope.work && !editRefusal(scope)
    ? {
        type: "cell:fields",
        id: key,
        work: scope.work.handle.key,
        path: ["fields", key],
      }
    : null;
}

/** One coupled Page move selects the member and its kernel-owned Work. */
export function podsTransition(current: Readonly<PodsPage>, patch: Readonly<Partial<PodsPage>>) {
  const subject = patch.member ? parseContributionKey(patch.member) : null;
  const selection =
    subject?.kind === "member" ? { pod: subject.packageId, path: subject.path } : {};
  const next = { ...patch, ...selection };
  const changed =
    (next.pod !== undefined && next.pod !== current.pod) ||
    (next.path !== undefined && next.path !== current.path);
  return {
    patch: {
      ...next,
      member: workSubject({ ...current, ...next }),
      ...(changed && { pendingDraft: false }),
    },
  };
}
