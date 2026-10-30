import { z } from "zod";
import {
  actionReceiptSchema,
  actionStatusSchema,
  parsedDocViewSchema,
  settingsSnapshotSchema,
  workKey,
  type ActionStatus,
  type ParsedDocView,
  type PodMember,
  type SettingsSnapshot,
} from "@pe/agent-contracts";
import type { PodList } from "@pe/host-contracts/operation-types";
import { jsonSource, requestJson } from "#/shell/readings-api";
import { subscriptionSource } from "#/shell/readings-use";
import type { ReadingContext, ReadingSource, UseSource } from "#/shell/readings";
import type { FamilyPage } from "./graph";
import { assetUrl } from "./spec";

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
    "family.profile": {
      kind: "use",
      dirties: ["pods"],
      effects: () => [],
      async open(ctx, deliver) {
        const ref = member(ctx);
        if (!ref) return deliver({ kind: "complete", value: null, revision: 0 });
        try {
          const read = await requestJson(
            { path: "/call", body: { key: "pod.member.read", request: ref } },
            z.object({ content: z.string(), sha256: z.string() }),
            ctx.signal,
          );
          const composed = await requestJson(
            {
              path: "/call",
              body: { key: "pod.member.compose", request: { ...ref, content: read.content } },
            },
            z.object({
              composed: z.string().nullable(),
              dependencies: settingsSnapshotSchema.shape.dependencies.unwrap(),
              diagnostics: z.array(
                z.object({ message: z.string(), severity: z.string() }).passthrough(),
              ),
            }),
            ctx.signal,
          );
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
                      input.kind === "work" && workKey(input.probe.handle.key) === ctx.workKey,
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
          const link = await requestJson(
            { path: assetUrl(ref.pod, `${ref.path}.spec.json`) },
            z.object({ path: z.string() }),
            ctx.signal,
          );
          const doc = await requestJson(
            { path: assetUrl(ref.pod, link.path) },
            parsedDocViewSchema,
            ctx.signal,
          );
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
      ...jsonSource({
        request: () => ({ path: "/call", body: { key: "pod.list", request: {} } }),
        schema: z
          .object({ pods: z.array(z.custom<PodList["pods"][number]>()) })
          .transform((value) => value.pods),
        absent: [],
      }),
      effects: () => [],
      dirties: ["pods"],
    },
  };
}
