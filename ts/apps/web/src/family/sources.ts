import { z } from "zod";
import {
  actionReceiptSchema,
  actionStatusSchema,
  settingsSnapshotSchema,
  workKey,
  type ActionStatus,
  type ParsedDocView,
  type PodMember,
  type SettingsSnapshot,
} from "@pe/agent-contracts";
import { callOp, callCompose, opSource } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource, UseSource } from "#/shell/readings";
import type { FamilyPage } from "./graph";

const page = (ctx: ReadingContext) => ctx.page as FamilyPage;
const member = (ctx: ReadingContext) =>
  page(ctx).pod && page(ctx).path ? { pod: page(ctx).pod, path: page(ctx).path } : null;
export interface FamilySpecReading {
  member: PodMember;
  doc: ParsedDocView;
}
export const readingValue = <T>(
  value: { value?: unknown; previous?: unknown } | undefined,
): T | null => (value?.value ?? value?.previous ?? null) as T | null;

export function latestFamilyStatus(
  rows: readonly ActionStatus[],
  key: string,
  ctx: Pick<ReadingContext, "target">,
) {
  return rows
    .filter(
      (row) =>
        row.key === key &&
        row.state === "succeeded" &&
        row.target.kind === "document" &&
        ctx.target.kind === "document" &&
        row.target.ref.session === ctx.target.ref.session &&
        row.target.ref.openId === ctx.target.ref.openId,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

function receiptSource(key: string): UseSource {
  return {
    kind: "use",
    dirties: ["family", "receipts"],
    open(ctx, deliver) {
      const statuses = readingValue<ActionStatus[]>(ctx.inputs.receipts) ?? [];
      const status = latestFamilyStatus(statuses, key, ctx);
      if (!status) return deliver({ kind: "complete", value: [], revision: 0 });
      if (key === "family.build") {
        const profile = readingValue<SettingsSnapshot>(ctx.inputs.profile);
        const input = status.input as { source?: { pod?: string; path?: string; sha256?: string } };
        if (
          !profile ||
          profile.member.pod !== member(ctx)?.pod ||
          profile.member.path !== member(ctx)?.path ||
          input.source?.pod !== profile.member.pod ||
          input.source.path !== profile.member.path ||
          input.source.sha256 !== profile.sha256
        )
          return deliver({ kind: "complete", value: [], revision: 0 });
      }
      return subscriptionSource({
        request: () => ({ kind: "receipts", id: status.id }),
        decode: (value) => z.array(actionReceiptSchema).parse(value),
      }).open(ctx, deliver);
    },
  };
}

export function familySources(): Readonly<Record<string, ReadingSource>> {
  return {
    "family.draft": {
      kind: "derive",
      derive: ({ target, work, inputs }) => ({
        target,
        draft: work,
        profile: inputs.profile?.value,
        captured: inputs.captureReceipt?.value,
      }),
    },
    "family.document": {
      kind: "derive",
      derive: ({ target }) =>
        target.kind === "document" ? [{ id: "current", document: target.ref }] : [],
    },
    "family.profile": {
      kind: "use",
      dirties: ["pods"],
      effects: () => [],
      async open(ctx, deliver) {
        const ref = member(ctx);
        if (!ref) return deliver({ kind: "complete", value: null, revision: 0 });
        try {
          const read = await callOp({ signal: ctx.signal }, "pod.member.read", ref);
          const composed = await callOp({ signal: ctx.signal }, "pod.member.compose", {
            ...ref,
            content: read.content,
          });
          deliver({
            kind: "complete",
            value: settingsSnapshotSchema.parse({
              member: ref,
              sha256: read.sha256,
              observedAt: new Date().toISOString(),
              rawContent: read.content,
              composedContent: composed.composed,
              dependencies: composed.dependencies,
              validation: {
                isValid: !composed.diagnostics.some((issue) => issue.severity === "error"),
                issues: composed.diagnostics,
              },
            }),
            revision: 1,
            sourceVersion: read.sha256,
          });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
    "family.receipts": {
      kind: "use",
      dirties: ["family", "receipts"],
      open(ctx, deliver) {
        return subscriptionSource({
          request: () => ({ kind: "receipts" }),
          decode: (value) =>
            z
              .array(actionStatusSchema)
              .parse(value)
              .filter(
                (row) =>
                  row.consumes.some(
                    (input) =>
                      input.kind === "work" &&
                      ctx.workKey !== null &&
                      workKey(input.probe.handle.key) === workKey(ctx.workKey),
                  ) &&
                  (row.target.kind !== "document" ||
                    (ctx.target.kind === "document" &&
                      row.target.ref.session === ctx.target.ref.session &&
                      row.target.ref.openId === ctx.target.ref.openId)),
              ),
        }).open(ctx, deliver);
      },
    },
    "family.apply-receipt": receiptSource("family.apply"),
    "family.capture-receipt": receiptSource("family.capture"),
    "family.build-receipt": receiptSource("family.build"),
    "family.spec": {
      kind: "use",
      dirties: ["family", "pods"],
      async open(ctx, deliver) {
        const ref = member(ctx);
        if (!ref) return deliver({ kind: "complete", value: null, revision: 0 });
        try {
          const link = await callCompose(ctx, "family.spec", {
            query: { pod: ref.pod, path: `${ref.path}.spec.json` },
          });
          if (!("path" in link)) throw Error("Expected a family spec link");
          const doc = await callCompose(ctx, "family.spec", {
            query: { pod: ref.pod, path: link.path },
          });
          if (!("pages" in doc)) throw Error("Expected a family spec document");
          deliver({
            kind: "complete",
            value: { member: ref, doc } satisfies FamilySpecReading,
            revision: 1,
          });
        } catch (error) {
          if (!ctx.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    },
    "family.pods": {
      ...opSource({
        key: "pod.list",
        request: () => ({}),
        map: (value) => {
          if (!("pods" in value)) throw Error("Expected full pod inventory");
          return value.pods;
        },
        absent: [],
      }),
      effects: () => [],
      dirties: ["pods"],
    },
  };
}
