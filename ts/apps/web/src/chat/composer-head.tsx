/** Chat's whole Situation, drawn in the composer: Work and live asks at the top of the box, the
 *  next turn's provider, traits and document targets as marks in the lane beside Send. A thread
 *  targets a set of documents (ADR 0021): a pick toggles one in the set (`PUT /scope/:thread`), and
 *  a `?target` pin seeds a document-less thread once. The targeted names are context for Pea, never write authority. */
import { useEffect, useRef, type SVGProps } from "react";
import {
  resolveCallTarget,
  machineInventory,
  headRequests,
  targetKey,
  type DocumentRequest,
  type TargetResolution,
  type Machine,
} from "@pe/agent-contracts";
import { X } from "lucide-react";
import { Popover } from "@base-ui/react/popover";
import { PopupFrame } from "@pe/kit/lang/list-popup";
import { useAtomValue } from "@effect/atom-react";

import { Button } from "@pe/kit/lang/button";
import { Tag } from "@pe/kit/lang/chip";
import { previousOf } from "#/host/resource-state";
import { Ladder } from "#/route/ladder";
import { useDocumentLadder } from "#/route/situation-ladder";
import type { RouteHandle } from "#/route/handle";

import { chatReading, type ChatHandle } from "./owner-ports";
export type { ChatHandle } from "./owner-ports";

import { PrimaryRouteControls } from "#/navigation/route-controls";
import { RouteHelpButton } from "#/route/help";
import { useThreadScope } from "#/chat/scope";
import { pinnedDocument } from "#/workbench/sole-user-document";
import {
  selectQuestions,
  selectPlan,
  selectRunStatus,
  selectTitle,
} from "@pe/agent-contracts/chat-state";
import { useTranscript, useWorkbench } from "#/workbench/provider";

import { useHeadWorks } from "./head-works";
import { targetClosure, targetLabel } from "#/workbench/thread-navigation";
import { ProposalHead } from "./proposal-head";
import { ComposerOpenMode } from "./composer-open";
import { ComposerPending } from "./composer-pending";
import { HeadLadder } from "./head-chips";
import { emptyPrompt, type ChatDraft } from "#/workbench/prompt";

/**
 * Send, scoped to the composer draft: the one verb, whether pressed in the head or entered in the
 * textarea. The host's thread prompt command owns validation and the harness stream owns completion.
 */
export function useSend(_handle: ChatHandle, draft: ChatDraft, onSent?: (sent: ChatDraft) => void) {
  const input = {
    text: draft.text.trim(),
    attachments: draft.attachments.length ? draft.attachments : undefined,
    mentions: draft.mentions.length ? draft.mentions : undefined,
  };
  const workbench = useWorkbench();
  return {
    label: "Send",
    says: undefined,
    refusal: workbench.sendRefusal ?? emptyPrompt(draft),
    run: async () => {
      try {
        // SHIM: S gap 9 must expose typed host commands before this can use the shared command door.
        await workbench.sendPrompt(input);
        onSent?.(draft);
        return null;
      } catch (error) {
        return { code: "not-ready" as const, message: String(error) };
      }
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
            "several-targets": "this thread targets several documents",
            "session-gone": "the Revit holding it ended — choose again",
            "document-closed": "it is no longer open — choose again",
            "wrong-document-kind": "that document is the wrong kind for this call",
            ambiguous: "two Revits hold it — choose the document again",
          }[resolution.reason];

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

/**
 * The thread's head, or the draft's own target before the first send creates a thread. A draft
 * holds one document; more are added once the thread exists.
 */
export function useThreadHead() {
  const { currentThreadId, draftTarget, setDraftTarget } = useWorkbench();
  // SHIM: live head stays outside Value until the shared thread Page/carry contract is available.
  // Scope PUTs publish thread-head snapshots; the existing body cache is not invalidated by them.
  const scope = useThreadScope(currentThreadId, true);
  if (currentThreadId) return scope;
  const set = async (targets: Parameters<typeof scope.set>[0]) => {
    setDraftTarget(targets.at(-1)?.request ?? null);
    return true;
  };
  return {
    ...scope,
    // A local draft has no host snapshot that can become stale.
    stale: false,
    targets: draftTarget ? [{ request: draftTarget, admission: null }] : [],
    set,
    toggle: async (target: DocumentRequest) =>
      set(draftTarget && targetKey(draftTarget) === targetKey(target) ? [] : [{ request: target }]),
  };
}

/** What both the composer head and the thread head's cluster read: the thread's target and its
 *  health. Called ONCE per surface (ChatSurface) and handed to both. */
export function useChatSituation(handle: ChatHandle) {
  const { currentThreadId, threads, missingThread } = useWorkbench();
  const title = useTranscript(selectTitle);
  const head = useThreadHead();
  const machine = previousOf(chatReading<Machine>(handle, "machine"));
  const inventory = machineInventory(machine);
  const requests = headRequests(head);
  const resolution = resolveCallTarget({ needs: "document" }, requests, inventory);
  const bound =
    resolution.kind === "resolved" && resolution.target.kind === "document"
      ? resolution.target.ref
      : null;
  // Every exact open document the thread targets, checked in the multi-select.
  const targets = requests.flatMap((request) => {
    const one = resolveCallTarget({ needs: "document" }, [request], inventory);
    return one.kind === "resolved" && one.target.kind === "document" ? [one.target.ref] : [];
  });
  const ladder = useDocumentLadder(
    { readings: { machine: chatReading<Machine>(handle, "machine") } } as unknown as RouteHandle<
      unknown,
      string,
      unknown,
      string
    >,
    undefined,
    {
      bound,
      targets,
      bind: (ref) => {
        const label = documentAddress(inventory, ref)?.split(/[\\/]/).at(-1);
        void head.toggle({ kind: "open", ref }, label);
      },
    },
  );
  // A thread with several targets is healthy: a call names one. Only a closed one complains.
  const health =
    requests.length && !(resolution.kind === "choose" && resolution.reason === "several-targets")
      ? complaint(resolution)
      : null;
  // The inventory is the authority; a saved target is a request, shown as missing when gone.
  const closed = requests.some((request) => targetClosure(request, inventory));
  const closedWord = closed ? `${targetLabel({ head })} · closed` : null;
  // A thread the host does not know names nothing: the transcript says "no such thread".
  const threadLabel = missingThread
    ? ""
    : title || threads.find((item) => item.id === currentThreadId)?.title || currentThreadId;
  const origin = handle.value.publication?.origin;
  return {
    head,
    demo:
      typeof origin === "object" &&
      origin !== null &&
      "kind" in origin &&
      origin.kind === "fixture",
    inventory,
    bound,
    ladder,
    health,
    closedWord,
    threadLabel,
    threadId: missingThread ? null : currentThreadId,
  };
}

export type ChatSituation = ReturnType<typeof useChatSituation>;

/** Lamp · gauge · help · theme for Chat — it rides the thread head, not the composer. */
export function ChatCluster(_props: { handle: ChatHandle; situation: ChatSituation }) {
  return (
    <>
      <PrimaryRouteControls route="chat">
        <RouteHelpButton
          name="Pea"
          docs="Choose a thread, then send a prompt under its chosen target."
          utilities
        />
      </PrimaryRouteControls>
    </>
  );
}

/** The pickers as marks: provider › model › traits, then the document target, whose popup carries
 *  the target/open switch. */
export function ComposerPickers({
  situation,
  urlTarget,
}: {
  /** The URL's `?target` pin: a thread with no document takes it once (e2e finding 7). */
  urlTarget?: string;
  situation: ChatSituation;
}) {
  const { currentThreadId } = useWorkbench();
  const isRunning = useTranscript((state) => selectRunStatus(state) !== "idle");
  const { head, inventory, ladder, health, closedWord } = situation;
  // A new thread under a `?target` address pin binds to the one open document at that address,
  // once per thread: "new" keeps the URL's document. A later clear in the picker stands.
  const pinned = useRef<string | null>(null);
  const pinRef = pinnedDocument(inventory, urlTarget)?.ref ?? null;
  useEffect(() => {
    if (!pinRef || head.stale || !head.hydrated || head.targets.length) return;
    if (pinned.current === currentThreadId) return;
    pinned.current = currentThreadId;
    void head.set([{ request: { kind: "open", ref: pinRef } }]);
  }, [
    pinRef?.session,
    pinRef?.openId,
    head.stale,
    head.hydrated,
    head.targets.length,
    currentThreadId,
  ]);
  const targetDisabled = isRunning || head.stale;
  // A closed target names itself in the first empty slot, in the caution tone, and the picker
  // lists only the live inventory.
  const unbound = ladder.levels.findIndex((level) => level.label === null);
  const levels = ladder.levels
    .map((level) => ({ ...level, ...(situation.demo ? { provenance: <Tag>Demo</Tag> } : {}) }))
    .map((level, index) =>
      index === 0
        ? {
            ...level,
            placeholder: !head.targets.length
              ? "choose Revit documents (optional)"
              : index === unbound && closedWord
                ? closedWord
                : level.placeholder,
            extra: (
              <>
                {level.extra}
                {head.targets.length ? (
                  <div className="hairline-t mt-1 px-2 pt-1">
                    <Button
                      icon={X}
                      kind="framed"
                      label="Clear targets"
                      reason="Run this chat without Revit documents"
                      refusal={targetDisabled ? "Run this chat without Revit documents" : null}
                      onClick={() => {
                        void head.set([]);
                      }}
                    >
                      Clear targets
                    </Button>
                  </div>
                ) : null}
              </>
            ),
          }
        : index === unbound && closedWord
          ? { ...level, placeholder: closedWord }
          : level,
    );
  return (
    <section aria-label="Pea situation" className="contents" data-testid="composer-head">
      <HeadLadder face="icon" />
      <ComposerOpenMode>
        {(header) => (
          <Ladder
            face="icon"
            header={header}
            mark={<RevitMark />}
            levels={levels}
            caution={Boolean(health)}
            disabled={targetDisabled}
            title={
              head.targets.length > 1
                ? `${targetLabel({ head })}; pick to add or remove`
                : ladder.sessionWord
                  ? `${ladder.sessionWord} › ${ladder.docWord ?? "no document"}; pick to add or remove`
                  : "choose a session and documents; Chat runs without one, Revit operations do not"
            }
          />
        )}
      </ComposerOpenMode>
    </section>
  );
}

/** Pea's plan beside the pickers. Send owns run state. */
export function ComposerState(_: { situation: ChatSituation }) {
  const tasks = useTranscript(selectPlan);
  return <PlanChip tasks={tasks} />;
}

/** Pea's live questions, then the Work the bound document holds: the top of the composer box. */
export function ComposerWork({ situation }: { situation: ChatSituation }) {
  const { answerQuestion, store, cancel, currentThreadId } = useWorkbench();
  const questions = useTranscript(selectQuestions);
  const { inventory, bound, ladder } = situation;
  // Live asks only: an expired ask is a transcript record, never a head row.
  const works = useHeadWorks(
    documentAddress(inventory, bound),
    ladder.docWord ?? "document",
    {
      // keep: a review lands on the open tab without resetting the system the person chose.
      open: (place) => void store.actions.openTab(place.route, place.page, place.carry, true),
      planIn: (place) => store.actions.planIn(place.route, place.page, place.carry),
      planRefusal: useAtomValue(store.atoms.planRefusal),
    },
    bound,
  );
  return (
    <>
      <ComposerPending questions={questions} answerQuestion={answerQuestion} />
      <ProposalHead asks={[]} works={works} />
      {currentThreadId && (
        <Button kind="quiet" label="Revoke writes" onClick={() => void cancel()}>
          Revoke writes
        </Button>
      )}
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

/** The document control's glyph: Revit's tile, a square with its R cut through, in currentColor. */
export function RevitMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="2 2 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        d="M4 2h16a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm4 4v12h2.6v-4.4h1.7l2.9 4.4h3l-3.3-4.8A3.9 3.9 0 0 0 13.2 6Zm2.6 2.2h2.5a1.6 1.6 0 0 1 0 3.2h-2.5Z"
      />
    </svg>
  );
}
