import {
  type PodMember,
  type SettingsRouteDocument,
  settingsBasisSchema,
  settingsCandidate,
} from "@pe/agent-contracts";
import type { RouteStateCommandHandlers } from "@pe/agent-contracts";

import { HostRpcCaller } from "../shared/host-rpc-caller.ts";
import { resolveHostBaseUrl } from "../shared/host-config.ts";
import type {
  PodMemberComposeRequest,
  PodMemberComposeResponse as MemberComposition,
  PodMemberRead as MemberReading,
} from "@pe/host-contracts/operation-types";

/** Execution uses the member's composition; raw JSON stays authored. */
export function executionContent(composition: MemberComposition): string {
  const errors = composition.diagnostics.filter((issue) => issue.severity !== "info");
  if (errors.length)
    throw new Error(errors.map((issue) => `${issue.path}: ${issue.message}`).join("\n"));
  if (composition.composed == null)
    throw new Error("The member did not compose; composition needs a Revit session.");
  return composition.composed;
}

/** Work commands edit one pod member; root owns admission and receipts. */
export function createSettingsCommandHandlers(
  options: {
    hostBaseUrl?: string;
    pods?: {
      read(this: void, member: PodMember): Promise<MemberReading>;
      compose(this: void, request: PodMemberComposeRequest): Promise<MemberComposition>;
    };
  } = {},
): RouteStateCommandHandlers<SettingsRouteDocument> {
  const caller = () => new HostRpcCaller({ hostBaseUrl: resolveHostBaseUrl(options.hostBaseUrl) });
  const read = (member: PodMember) =>
    (
      options.pods?.read ??
      ((request: PodMember) => caller().call("pod.member.read", request))
    )(member);
  const compose = (request: PodMemberComposeRequest) =>
    (options.pods?.compose ?? ((value) => caller().call("pod.member.compose", value)))(request);
  const basis = async (member: PodMember) => {
    const reading = await read(member);
    return settingsBasisSchema.parse({
      member,
      rawContent: reading.content,
      sha256: reading.sha256,
    });
  };
  const requireWork = (ctx: { work?: string }) => {
    if (!ctx.work) throw new Error("Pod member work requires the host-resolved Work key.");
  };
  const requireBasis = (document: SettingsRouteDocument) => {
    if (!document.basis) throw new Error("Open a pod member and adopt its basis first.");
    return document.basis;
  };
  const pending = (document: SettingsRouteDocument) =>
    Object.values(document.fields).some((field) => field.staged || field.proposal);
  const sameMember = (a: PodMember, b: PodMember) => a.pod === b.pod && a.path === b.path;
  return {
    open: async (input, ctx) => {
      requireWork(ctx);
      const { member } = input as { member: PodMember };
      const document = ctx.getDoc();
      const next = await basis(member);
      if (
        document.basis &&
        sameMember(document.basis.member, member) &&
        document.basis.sha256 === next.sha256
      )
        return next;
      if (pending(document))
        throw new Error(
          "Pending work retains its original basis. Review the new reading and explicitly adopt it, discarding old edits.",
        );
      await ctx.setDoc({ basis: next, fields: {} });
      return next;
    },
    adopt: async (input, ctx) => {
      requireWork(ctx);
      const { member, sha256 } = input as { member: PodMember; sha256: string };
      const bound = ctx.getDoc().basis?.member;
      if (bound && !sameMember(bound, member))
        throw new Error("Adopt re-reads the bound member; open another member in its own Work.");
      const next = await basis(member);
      if (next.sha256 !== sha256)
        throw new Error("The member changed after review. Refresh and review again.");
      await ctx.setDoc({ basis: next, fields: {} });
      return next;
    },
    refresh: async (_input, ctx) => {
      requireWork(ctx);
      return basis(requireBasis(ctx.getDoc()).member);
    },
    validate: async (input, ctx) => {
      const document = ctx.getDoc();
      const original = requireBasis(document);
      return compose({
        ...original.member,
        content: settingsCandidate(
          original.rawContent,
          document.fields,
          Boolean((input as { includeProposals?: boolean }).includeProposals),
        ),
      });
    },
  };
}
