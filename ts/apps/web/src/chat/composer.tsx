import { listOf } from "@pe/kit/lang/collection";
// The thread's composer: fills the one `Composer` box with attachments, slash and `@` menus and
// the pickers. Logic lives in the hooks and `useSend`.
import { useMemo, useState, type ReactNode } from "react";
import { ArrowUp, GitFork, Paperclip, Square } from "lucide-react";
import {
  capabilityCatalogSchema,
  type Capability,
  type CapabilityCatalog,
  type Machine,
} from "@pe/agent-contracts";
import { FirstOpenCard, ProviderRepair } from "#/chat/first-open";
import { isReady } from "#/workbench/provider/providers";
import { Pane } from "@pe/kit/lang/pane";
import { ScopeKeys, type ScopeKey } from "@pe/kit/keys";
import { useTranscript, useWorkbench } from "#/workbench/provider";
import { EMPTY_CHAT_DRAFT, type ChatDraft } from "#/workbench/prompt";
import {
  selectMessages,
  selectQuestions,
  selectRunStatus,
  selectSkillCommands,
} from "@pe/agent-contracts/chat-state";
import { composerAnswer } from "./question-form";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { useSend, type ChatHandle } from "#/chat/composer-head";
import { chatReading } from "./owner-ports";
import { Composer, ComposerFrame } from "#/components/lang/conversation";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { MentionChip } from "@pe/kit/lang/chip";
import { previousOf } from "#/shell/readings-hooks";
import { AssetReel, referModel, threadAssets } from "./asset-reel";
import { AttachmentChip } from "./attachment-chip";
import { useAttachments } from "./use-attachments";
import { useSlashMenu, type SlashCommand } from "./use-slash-menu";
import {
  dropMention,
  liveCatalog,
  MENTION_GROUP_CAP,
  MENTION_KINDS,
  mentionFace,
  mentionWord,
  useMentions,
  withText,
} from "./use-mentions";

// N6: every visited thread mounts a composer and the machine Reading moves often; the catalog is
// parsed once per capabilities Reading, not per composer and per machine tick.
const parsedCatalogs = new WeakMap<object, CapabilityCatalog | undefined>();
function parseCatalog(raw: unknown): CapabilityCatalog | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  if (!parsedCatalogs.has(raw))
    parsedCatalogs.set(raw, capabilityCatalogSchema.safeParse(raw).data);
  return parsedCatalogs.get(raw);
}

/** The route handle's Enter runs Send scoped to this draft; `work` is the box's top section (live
 * asks, edit Work), `pickers` the provider and document pickers, `state` the run's. */
export function ThreadComposer({
  handle,
  pickers,
  state,
  work,
  refusal,
  initialDraft = EMPTY_CHAT_DRAFT,
  autoFocus = false,
}: {
  handle: ChatHandle;
  pickers: ReactNode;
  state?: ReactNode;
  work?: ReactNode;
  refusal?: string | null;
  initialDraft?: ChatDraft;
  /** Only the composer the page opened with takes focus; a thread switch leaves focus where it was. */
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const {
    providers,
    config,
    currentThreadId,
    threads,
    draft: head,
    answerQuestion,
    cancel,
    forkThread,
    operationError,
  } = useWorkbench();
  const { providerId, isRunning, commands, assets, asking } = useTranscript((state) => ({
    providerId: state.providerId,
    isRunning: selectRunStatus(state) !== "idle",
    commands: selectSkillCommands(state),
    assets: threadAssets(selectMessages(state)),
    asking: selectQuestions(state)[0],
  }));
  // Loaded and none ready: the composer carries the first-open doors and Send says why it waits.
  const noneReady = providers.list !== undefined && !providers.list.some(isReady);
  // Some ready, but not the one this head runs on: that provider carries its own repair.
  const headId = currentThreadId
    ? providerId || threads.find((item) => item.id === currentThreadId)?.providerId
    : head.providerId;
  const unready = noneReady ? undefined : providers.list?.find((item) => item.id === headId);
  const repairing = unready && !isReady(unready) ? unready : undefined;
  const send = useSend(handle, draft, (sent) => {
    setDraft((current) => (current === sent ? EMPTY_CHAT_DRAFT : current));
  });
  const files = useAttachments(draft, setDraft);
  const refusedSend = operationError;
  const slash = useSlashMenu(draft.text, commands);
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  const form = area?.form ?? null;
  // Documents come from the live inventory, never the catalog read at mount.
  const machine = previousOf(chatReading<Machine>(handle, "machine"));
  const read = parseCatalog(previousOf(chatReading(handle, "capabilities")));
  const catalog = useMemo(() => read && machine && liveCatalog(read, machine), [read, machine]);
  const mentions = useMentions(draft, setDraft, catalog, area, slash.open);
  const setText = (text: string) => setDraft((previous) => withText(previous, text));
  // A question Pea is waiting on takes the composer's text as its answer (its "Other" box), so
  // typing while Pea waits is never silently dropped behind a stop button.
  const answer = asking && composerAnswer(asking, draft.text.trim());
  const answerCurrent = async () => {
    if (!asking || !answer || !draft.text.trim()) return;
    const sent = draft;
    await answerQuestion(asking.requestId, "accept", answer);
    setDraft((current) => (current === sent ? EMPTY_CHAT_DRAFT : current));
  };
  const sendCurrent = () => void (asking ? answerCurrent() : send.run());
  const SkillIcon = MENTION_KINDS.skill.icon;

  const paneOwnsFocus = () =>
    document.activeElement === form?.closest<HTMLElement>("[data-slot='pane']");
  const shortcuts: ScopeKey[] = [
    {
      hotkey: "Enter",
      label: "send message",
      says: "Sends this draft. Shift+Enter adds a line.",
      callback: () => {
        if (paneOwnsFocus()) sendCurrent();
      },
      options: { preventDefault: false, stopPropagation: false },
    },
    {
      hotkey: "/",
      label: "skill commands",
      says: "Starts the composer skill menu from an empty draft.",
      callback: () => {
        if (!paneOwnsFocus()) return;
        if (!draft.text) setText("/");
        area?.focus();
      },
      options: { preventDefault: false, stopPropagation: false },
    },
    {
      hotkey: "Shift+2",
      label: "@ point at a thing",
      says: "Starts the composer mention menu from an empty draft.",
      callback: () => {
        if (!paneOwnsFocus()) return;
        if (!draft.text) {
          setText("@");
          mentions.onCaret(1);
          mentions.reset();
        }
        area?.focus();
      },
      options: { preventDefault: true, stopPropagation: false },
    },
  ];

  return (
    <Pane id="composer" scroll="visible" flush>
      <ScopeKeys keys={shortcuts} />
      <ComposerFrame>
        <Composer
          // Files dropped anywhere on the box attach; a file drag over it takes the recess ground.
          dragging={files.dragging}
          drop={files.dropProps}
          menus={
            <>
              <ListPopup<Capability>
                anchor="caret"
                caret={form}
                side="top"
                owner={area}
                open={mentions.open}
                onOpenChange={(open) => (open ? undefined : mentions.dismiss())}
                query={mentions.query}
                onCollection={mentions.bind}
                aria-label="Mentions"
                {...listOf(chatReading(handle, "capabilities"), () => mentions.rows)}
                keyOf={(row) => row.key}
                labelOf={(row) => row.title}
                groupOf={(row) => MENTION_KINDS[row.kind].group}
                groupCap={MENTION_GROUP_CAP}
                empty="nothing to mention"
                maxHeight="min(20rem, 45dvh)"
                onPick={mentions.pick}
                detail={(row) => catalog && mentionFace(row, catalog).detail}
                row={(row) => {
                  const Icon = MENTION_KINDS[row.kind].icon;
                  const face = catalog && mentionFace(row, catalog);
                  return {
                    lead: <Icon aria-hidden />,
                    label: face?.title ?? row.title,
                    aside: face?.mono ? <span className="face-mono">{face.fact}</span> : face?.fact,
                    title: row.key,
                  };
                }}
              />
              <ListPopup<SlashCommand>
                // Above the whole composer, never over its work or text.
                anchor="caret"
                caret={form}
                side="top"
                owner={area}
                open={slash.open}
                onOpenChange={(open) => (open ? undefined : slash.dismiss())}
                query={slash.query}
                onCollection={slash.bind}
                aria-label="Commands"
                items={commands}
                keyOf={(command) => command.name}
                labelOf={(command) => command.name}
                filter="substring"
                empty="no skills in this thread"
                maxHeight="min(20rem, 45dvh)"
                onPick={(command) => setText(slash.pick(command))}
                // a slash command is a machine identifier — mono; what it does reads in the footer
                row={(command) => ({
                  lead: <SkillIcon aria-hidden />,
                  label: <span className="face-mono">/{command.name}</span>,
                })}
                detail={(command) => command.description}
              />
            </>
          }
          work={
            <>
              {work}
              {noneReady ? <FirstOpenCard providers={providers} origin={config.origin} /> : null}
              {repairing ? <ProviderRepair provider={repairing} providers={providers} /> : null}
              {files.attachments.length > 0 || draft.mentions.length > 0 ? (
                <div className="flex flex-wrap items-end gap-1.5">
                  {draft.mentions.map((mention) => (
                    <MentionChip
                      key={mention.key}
                      label={mention.title}
                      kind={mentionWord(mention.kind)}
                      pointer={mention.key}
                      facts={mention.facts}
                      takenAt={mention.takenAt}
                      onRemove={() => setDraft((previous) => dropMention(previous, mention.key))}
                    />
                  ))}
                  {files.attachments.map((attachment, index) => (
                    <AttachmentChip
                      key={index}
                      attachment={attachment}
                      onRemove={() => files.remove(index)}
                    />
                  ))}
                </div>
              ) : null}
            </>
          }
          pickers={pickers}
          refusal={files.refusal ?? refusedSend ?? refusal}
          tools={
            state || noneReady ? (
              <>
                {state}
                {noneReady ? <span data-tone="caution">no provider is ready</span> : null}
              </>
            ) : null
          }
          fork={
            <Button
              label="fork"
              icon={GitFork}
              refusal={
                !currentThreadId
                  ? "No thread to fork yet"
                  : isRunning
                    ? "Fork after the running turn ends"
                    : null
              }
              onClick={() => void forkThread()}
            />
          }
          attach={
            <>
              <Button
                icon={Paperclip}
                label="Attach files: images and text, 5 MB each, 10 a message"
                onClick={files.browse}
              />
              <input {...files.fileInputProps} />
            </>
          }
          send={
            asking ? (
              <>
                <Button
                  label="stop"
                  icon={Square}
                  refusal={!currentThreadId ? "No running thread" : null}
                  onClick={() => void cancel()}
                />
                <Button
                  kind="commit"
                  label="Answer Pea's question"
                  icon={ArrowUp}
                  refusal={
                    !answer
                      ? "This question takes a pick, not text: answer it above"
                      : draft.text.trim()
                        ? null
                        : "Type your answer, or pick one above"
                  }
                  onClick={sendCurrent}
                />
              </>
            ) : isRunning ? (
              <Button
                label="stop"
                icon={Square}
                refusal={!currentThreadId ? "No running thread" : null}
                onClick={() => void cancel()}
              />
            ) : (
              <TooltipHint content={refusedSend ?? send.refusal ?? send.says}>
                <Button
                  kind="commit"
                  label={send.label}
                  icon={ArrowUp}
                  busy={isRunning}
                  data-tone={refusedSend ? "caution" : undefined}
                  aria-disabled={Boolean(send.refusal) || undefined}
                  onClick={sendCurrent}
                />
              </TooltipHint>
            )
          }
          onSend={sendCurrent}
          onKey={(event) => slash.onKeyDown(event) || mentions.onKeyDown(event)}
          name="input"
          aria-label="Message"
          areaRef={setArea}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          placeholder={
            noneReady
              ? "no provider is ready"
              : asking
                ? answer
                  ? "Pea is waiting on your answer; type it here, Enter sends it"
                  : "Pea is waiting on a pick in the question above"
                : "Ask Pea; / for a skill, @ to point at a thing"
          }
          autoFocus={autoFocus}
          value={draft.text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            mentions.onCaret(event.currentTarget.selectionStart);
            slash.reset();
            mentions.reset();
          }}
          onSelect={(event) => mentions.onCaret(event.currentTarget.selectionStart)}
          onPaste={files.pasteHandler}
        />
        <AssetReel
          assets={assets}
          onMention={(mention) => {
            setDraft((previous) => referModel(previous, mention));
            area?.focus();
          }}
        />
      </ComposerFrame>
    </Pane>
  );
}
