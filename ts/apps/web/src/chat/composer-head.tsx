/** Chat's whole Situation, drawn in the composer: Work and live asks at the top of the box, the
 *  next turn's provider, traits and document target in its bottom row beside Send. The target binds
 *  through the thread head (`PUT /scope/:thread`); a `?target` pin seeds a document-less thread once. */
import { useEffect, useRef } from "react";
import {
  resolveCallTarget,
  machineInventory,
  type TargetResolution,
  type Machine,
  type Reading,
} from "@pe/agent-contracts";
import { File, X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { PopupFrame } from "#/components/lang/list-popup";
import { useAtomValue } from "@effect/atom-react";

import { Button } from "#/components/lang/button";
import { previousOf } from "#/readings";
import { Ladder } from "#/route/ladder";
import { Ledger, PageLog } from "#/route/situation-grids";
import { useDocumentLadder } from "#/route/situation-ladder";
import { Cluster } from "#/route/situation-lamp";
import { parseTarget } from "#/route/route-target";
import type { ActionHandle, RouteHandle } from "#/route/use-route";
import type { ChatReading, ChatActionKey } from "#/chat/manifest";
import { useThreadScope } from "#/chat/scope";
import type { ChatPage } from "#/chat/seeds";
import {
  selectApprovals,
  selectQuestions,
  selectPlan,
  selectRunStatus,
  selectTitle,
  selectToolCalls,
  type ChatState,
} from "#/workbench/chat-state";
import { useWorkbench } from "#/workbench/provider";

import { useHeadWorks } from "./head-works";
import { targetClosure, targetLabel } from "./thread-navigation";
import { ProposalHead } from "./proposal-head";
import { ComposerOpenMode } from "./composer-open";
import { ComposerPending } from "./composer-pending";
import { GrantChip, HeadLadder } from "./head-chips";
import { emptyPrompt, type ChatDraft } from "#/workbench/prompt";

export type ChatHandle = RouteHandle<ChatState, ChatReading, ChatPage, ChatActionKey>;

/**
 * Send, scoped to the composer draft: the one verb, whether pressed in the head or entered in the
 * textarea. The route declares it once (`chat/manifest.ts`); this only names its input.
 */
export function useSend(
  handle: ChatHandle,
  draft: ChatDraft,
  onSent?: (sent: ChatDraft) => void,
): ActionHandle {
  const send = handle.actions.send;
  return {
    ...send,
    refusal: send.refusal ?? emptyPrompt(draft),
    run: async () => {
      const result = await send.run({
        text: draft.text.trim(),
        attachments: draft.attachments.length ? draft.attachments : undefined,
        mentions: draft.mentions.length ? draft.mentions : undefined,
      });
      if (!result) onSent?.(draft);
      return result;
    },
  };
}

/** Why the thread's chosen document does not resolve right now. */
const complaint = (resolution: TargetResolution): string | null =>
  resolution.kind === "resolved"
    ? null
    : resolution.kind === "checking"
      ? "checking the inventory"
      : resolution.kind === "failed"
        ? resolution.message
        : {
            missing: "no document chosen",
            "session-gone": "the Revit holding it ended — choose again",
            "document-closed": "it is no longer open — choose again",
            "wrong-document-kind": "that document is the wrong kind for this call",
            ambiguous: "two Revits hold it — choose the document again",
          }[resolution.reason];

/** The one open document at a `?target` address pin; none when absent or held twice. */
const pinnedRef = (inventory: ReturnType<typeof machineInventory>, target?: string) => {
  const parsed = parseTarget(target);
  if (parsed?.kind !== "address" || inventory.kind !== "ready") return null;
  const refs = Object.entries(inventory.sessions).flatMap(([session, found]) =>
    found.kind === "ready"
      ? found.values
          .filter((doc) => doc.address === parsed.address)
          .map((doc) => ({ session, openId: doc.openId }))
      : [],
  );
  return refs.length === 1 ? refs[0]! : null;
};

/** The bound document's Address, which keys document-owned Work. */
const documentAddress = (
  inventory: ReturnType<typeof machineInventory>,
  ref: { session: string; openId: string } | null,
) => {
  const found = ref && inventory.kind === "ready" ? inventory.sessions[ref.session] : undefined;
  return found?.kind === "ready"
    ? (found.values.find((doc) => doc.openId === ref!.openId)?.address ?? null)
    : null;
};

/** The thread's head, or the draft's own target before the first send creates a thread. */
function useThreadHead(handle: ChatHandle) {
  const { currentThreadId, draftTarget, setDraftTarget } = useWorkbench();
  const scope = useThreadScope(currentThreadId, !handle.demo, handle.readings.head);
  return currentThreadId || handle.demo
    ? scope
    : {
        ...scope,
        defaultTarget: draftTarget,
        set: async (target: Parameters<typeof scope.set>[0]) => {
          setDraftTarget(target);
          return true;
        },
      };
}

/** What both the composer head and the thread head's cluster read: the thread's target and its
 *  health. Called ONCE per surface (ChatSurface) and handed to both. */
export function useChatSituation(handle: ChatHandle) {
  const { currentThreadId, threads, chat, missingThread } = useWorkbench();
  const head = useThreadHead(handle);
  const inventory = machineInventory(previousOf(handle.readings.machine as Reading<Machine>));
  const resolution = resolveCallTarget({ needs: "document" }, head.defaultTarget, inventory);
  const bound =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  const ladder = useDocumentLadder(handle, undefined, {
    bound,
    bind: (ref) => {
      const label = documentAddress(inventory, ref)?.split(/[\\/]/).at(-1);
      void head.set({ kind: "open", ref }, label);
    },
  });
  const health = head.defaultTarget ? complaint(resolution) : null;
  // The inventory is the authority; the saved target is a request, shown as missing when gone.
  const closed = targetClosure(head.defaultTarget, inventory);
  const closedWord = closed ? `${targetLabel({ head })} · closed` : null;
  // A thread the host does not know names nothing: the transcript says "no such thread".
  const threadLabel = missingThread
    ? ""
    : selectTitle(chat) ||
      threads.find((item) => item.id === currentThreadId)?.title ||
      currentThreadId;
  return { head, inventory, bound, ladder, health, closedWord, threadLabel };
}

export type ChatSituation = ReturnType<typeof useChatSituation>;

/** Lamp · gauge · help · theme for Chat — it rides the thread head, not the composer. */
export function ChatCluster({
  handle,
  situation: { head, threadLabel },
}: {
  handle: ChatHandle;
  situation: ChatSituation;
}) {
  return (
    <Cluster
      handle={handle}
      helpUtilities
      // No lamp: the composer sentence names the target, and a hosted route draws its own.
      lamp={null}
      state={
        <>
          <Ledger
            rows={[
              ["thread", threadLabel],
              [
                "target",
                head.defaultTarget
                  ? `r${head.revision}${head.stale ? " · stale" : ""}`
                  : "none · Chat runs; Revit operations need a document",
              ],
            ]}
          />
          <PageLog entries={handle.log} manifest={handle.manifest} />
        </>
      }
    />
  );
}

/** The bottom row's lead: provider › model › traits, document target, then the run's state. */
export function ComposerControls({
  handle,
  situation,
  status,
  urlTarget,
}: {
  /** The URL's `?target` pin: a thread with no document takes it once (e2e finding 7). */
  urlTarget?: string;
  handle: ChatHandle;
  situation: ChatSituation;
  /** Thread-level loading or failure, said beside the pickers it qualifies. */
  status?: ComposerStatus;
}) {
  const { currentThreadId, chat } = useWorkbench();
  const isRunning = selectRunStatus(chat) !== "idle";
  const { head, inventory, ladder, health, closedWord } = situation;
  const refusal =
    head.refusal ?? (handle.outcome?.key === "send" ? handle.outcome.refusal?.message : null);
  // A new thread under a `?target` address pin binds to the one open document at that address,
  // once per thread: "new" keeps the URL's document. A later clear in the picker stands.
  const pinned = useRef<string | null>(null);
  const pinRef = pinnedRef(inventory, urlTarget);
  useEffect(() => {
    if (!pinRef || head.stale || !head.hydrated || head.defaultTarget) return;
    if (pinned.current === currentThreadId) return;
    pinned.current = currentThreadId;
    void head.set({ kind: "open", ref: pinRef });
  }, [
    pinRef?.session,
    pinRef?.openId,
    head.stale,
    head.hydrated,
    head.defaultTarget,
    currentThreadId,
  ]);
  const targetDisabled = isRunning || head.stale;
  // A closed target names itself in the first empty slot, in the caution tone, and the picker
  // lists only the live inventory.
  const unbound = ladder.levels.findIndex((level) => level.label === null);
  const levels = ladder.levels.map((level, index) =>
    index === 0
      ? {
          ...level,
          placeholder: !head.defaultTarget
            ? "choose a Revit document (optional)"
            : index === unbound && closedWord
              ? closedWord
              : level.placeholder,
          extra: head.defaultTarget ? (
            <div className="hairline-t mt-1 px-2 pt-1">
              <Button
                kind="framed"
                icon={X}
                label="Clear target"
                reason="Run this chat without a Revit target"
                refusal={targetDisabled ? "Run this chat without a Revit target" : null}
                onClick={() => {
                  void head.set(null);
                }}
              >
                Clear target
              </Button>
            </div>
          ) : undefined,
        }
      : index === unbound && closedWord
        ? { ...level, placeholder: closedWord }
        : level,
  );
  return (
    <section aria-label="Situation" className="contents" data-testid="composer-head">
      <HeadLadder />
      <ComposerOpenMode>
        <Ladder
          face="control"
          mark={<File className="size-3.5" data-tone={situation.bound ? "done" : undefined} />}
          levels={levels}
          caution={Boolean(health)}
          disabled={targetDisabled}
          title={
            ladder.sessionWord
              ? `${ladder.sessionWord} › ${ladder.docWord ?? "no document"}; pick to change`
              : "choose a session and a document; Chat runs without one, Revit operations do not"
          }
        />
      </ComposerOpenMode>
      <GrantChip grant={head.grantView} />
      {status ? (
        <span
          aria-live="polite"
          className="t-sentence"
          data-tone={
            status.caution ? "alarm" : status.text === "waiting for you" ? "caution" : undefined
          }
          data-testid="composer-status"
        >
          {status.text}
        </span>
      ) : null}
      <PlanChip tasks={selectPlan(chat)} />
      {refusal ? <span data-tone="caution">{refusal}</span> : null}
    </section>
  );
}

export type ComposerStatus = { text: string; caution: boolean; detail?: string };

/** Pea's live asks, then the Work the bound document holds: the top of the composer box, so
 *  approve and reject have one location and the draft sits under what is staged. */
export function ComposerWork({
  situation,
  status,
}: {
  situation: ChatSituation;
  status?: ComposerStatus;
}) {
  const { chat, resolveApproval, answerQuestion, store } = useWorkbench();
  const { inventory, bound, ladder } = situation;
  // Live asks only: an expired ask is a transcript record, never a head row.
  const approvals = selectApprovals(chat);
  const questions = selectQuestions(chat);
  const works = useHeadWorks(documentAddress(inventory, bound), ladder.docWord ?? "document", {
    open: store.actions.setPlugin,
    planIn: store.actions.planIn,
    planRefusal: useAtomValue(store.atoms.planRefusal),
  });
  return (
    <>
      {status?.detail ? (
        <div
          role="alert"
          className="px-(--gutter) pt-(--gutter)"
          data-testid="composer-status-detail"
          data-tone="caution"
        >
          {status.detail}
        </div>
      ) : null}
      <ComposerPending
        approvals={approvals}
        questions={questions}
        calls={selectToolCalls(chat)}
        resolveApproval={resolveApproval}
        answerQuestion={answerQuestion}
      />
      <ProposalHead asks={[]} works={works} />
    </>
  );
}

type PlanTask = ReturnType<typeof selectPlan>[number];

/** Pea's plan as one framed `plan x/y` button; the list opens over the lane. Nothing without a plan. */
function PlanChip({ tasks }: { tasks: readonly PlanTask[] }) {
  if (tasks.length === 0) return null;
  const done = tasks.filter((task) => task.status === "completed").length;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button kind="framed" label="Pea's plan for this run" reason="Pea's plan for this run" />
        }
      >
        <span className="face-mono">
          plan {done}/{tasks.length}
        </span>
      </Popover.Trigger>
      <PopupFrame side="top" align="end" label="Pea's plan for this run">
        <div className="grid max-h-(--available-height) w-[32rem] overflow-auto p-1.5 t-small text-ink-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="grid grid-cols-[12px_minmax(0,1fr)] gap-1 px-1 py-0.5"
              data-status={task.status}
            >
              <span data-tone={task.status === "completed" ? "done" : undefined}>
                {task.status === "completed" ? "✓" : task.status === "in_progress" ? "▸" : "○"}
              </span>
              <span className={task.status === "in_progress" ? "text-ink" : undefined}>
                {task.content}
              </span>
            </div>
          ))}
        </div>
      </PopupFrame>
    </Popover.Root>
  );
}
