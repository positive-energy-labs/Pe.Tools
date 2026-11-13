import { z } from "zod";
import {
  actionStatusSchema,
  refuse,
  workKey,
  workKeySchema,
  workTimelineArgsSchema,
  workTimelineSchema,
  WORK_TIMELINE_READ,
  type ActionStatus,
  type Caller,
  type StepRef,
  type WorkAuthor,
  type WorkKey,
  type WorkStepRequest,
  type WorkTimeline,
} from "@pe/agent-contracts";
import { FINDINGS_OWNER } from "@pe/agent-contracts/slots";
import { mergeTimeline, sameStep, type RouteWorkspace, type TimelinePart } from "@pe/runtime";
import type { ActionJournal } from "../action-journal.ts";
import { leaf, read } from "./door.ts";

/**
 * A second source of Timeline rows and steps beside the Work journals (contract K-A5). It answers
 * for the Works of one Place: its rows oldest first, and the caller's next step each way.
 */
export interface TimelineSource {
  read(works: readonly WorkKey[], by: WorkAuthor): Promise<TimelinePart> | TimelinePart;
  /** Takes the step the Timeline chose from this source; the result is the door's response. */
  step(direction: "undo" | "redo", expected: StepRef, caller: Caller): Promise<unknown>;
}
const sources = new Set<TimelineSource>();
/** The one registration point for a source that is not a Work journal. Returns its release. */
export function registerTimelineSource(source: TimelineSource): () => void {
  sources.add(source);
  return () => void sources.delete(source);
}

/**
 * K-A4: the document's findings Work is a member of every Place bound to a document. The host adds
 * it; a client never sends it.
 */
export const timelineMembers = (works: readonly WorkKey[]): WorkKey[] => {
  const bound = works.find((key) => key.binding === "address" || key.binding === "open");
  const members = works.filter((key) => key.route !== FINDINGS_OWNER);
  return bound ? [...members, { ...bound, route: FINDINGS_OWNER }] : members;
};

// ponytail: one scan of every action receipt per Timeline read or step; an index by consumed Work
// (the action journal's phase 5 C) replaces it when the journal is large enough to feel.
export const timelineReceipts = async (journal: Pick<ActionJournal, "read">): Promise<ActionStatus[]> =>
  (await journal.read({ kinds: ["action"] })).flatMap((row) =>
    row.body.kind === "action" ? [actionStatusSchema.parse(row.body.value)] : [],
  );

/** The host Timeline (ADR 0042): one read and one step door over the Work journals and every registered source. */
export function hostTimeline(workspace: RouteWorkspace, journal: Pick<ActionJournal, "read">) {
  const parts = async (works: readonly WorkKey[], by: WorkAuthor, receipts: readonly ActionStatus[]) =>
    Promise.all([workspace.timeline(works, by, receipts), ...[...sources].map((source) => source.read(works, by))]);
  return {
    async read(works: readonly WorkKey[], by: WorkAuthor): Promise<WorkTimeline> {
      const members = timelineMembers(works);
      return mergeTimeline(await parts(members, by, await timelineReceipts(journal))).timeline;
    },
    /** The same door for a person and Pea: the caller sends back the step it was shown. */
    async step(request: WorkStepRequest, caller: Caller, by: WorkAuthor): Promise<unknown> {
      const members = timelineMembers(request.works);
      const receipts = await timelineReceipts(journal);
      const next = mergeTimeline(await parts(members, by, receipts))[request.direction];
      if (!next) return refuse("refused", `Nothing to ${request.direction}`, "Re-read the Timeline.");
      if (!sameStep(next.candidate.ref, request.expected))
        return refuse(
          "refused",
          `The Timeline changed: ${request.direction} would now take "${next.candidate.ref.label}"`,
          "Re-read the Timeline.",
          "stale_revision",
        );
      if (next.candidate.refusal) return refuse("refused", next.candidate.refusal, "Re-read the Timeline.");
      return next.source === 0
        ? workspace.step(members, by, request.direction, request.expected, receipts)
        : [...sources][next.source - 1]!.step(request.direction, request.expected, caller);
    },
  };
}
export type HostTimeline = ReturnType<typeof hostTimeline>;

const timelineInput = workTimelineArgsSchema.extend({ by: z.enum(["human", "pea"]) });
/** Tracked input: it moves with any Work write and any action receipt (`reads/invalidations.ts`). */
export const workTimelineInput = leaf("work-timeline", timelineInput, workTimelineSchema, false);
/**
 * `work.timeline`. Its answer is per caller, so the read door stamps `by` from the request's
 * identity over anything the client sent (`withTimelineCaller`).
 */
export const workTimelineRead = read(WORK_TIMELINE_READ, {
  input: timelineInput,
  output: workTimelineSchema,
  run: (ctx, args) => ctx.read(workTimelineInput, args),
});
export const withTimelineCaller = (name: string, args: unknown, by: WorkAuthor | null): unknown =>
  name === WORK_TIMELINE_READ
    ? { works: z.object({ works: z.array(workKeySchema) }).parse(args).works, by: by ?? "human" }
    : args;
export const sameWorks = (a: WorkKey, b: WorkKey) => workKey(a) === workKey(b);
