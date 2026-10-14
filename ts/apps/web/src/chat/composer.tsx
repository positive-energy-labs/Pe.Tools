// The thread's composer: fills the one `Composer` box with attachments, slash and `@` menus and
// the pickers. Logic lives in the hooks and `useSend`.
import { useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUp, GitFork, Paperclip, Square } from "lucide-react";
import {
  capabilityCatalogSchema,
  type Capability,
  type Machine,
  type Reading,
} from "@pe/agent-contracts";
import { FirstOpenCard, ProviderRepair } from "#/chat/first-open";
import { isReady } from "#/workbench/provider/providers";
import { Pane } from "#/components/lang/pane";
import { ScopeKeys, type ScopeKey } from "@pe/kit/keys";
import { useWorkbench } from "#/workbench/provider";
import { useSurfaceHost } from "#/navigation/surface-host";
import { EMPTY_CHAT_DRAFT, type ChatDraft } from "#/workbench/prompt";
import { selectRunStatus, selectSkillCommands } from "@pe/agent-contracts/chat-state";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { useSend, type ChatHandle } from "#/chat/composer-head";
import { SituationAction } from "#/route/situation-verbs";
import { Composer, ComposerFrame, type ComposerHandle } from "#/components/lang/conversation";
import { Button } from "@pe/kit/lang/button";
import { MentionChip } from "@pe/kit/lang/chip";
import { previousOf } from "#/readings";
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

/** The route handle's Enter runs Send scoped to this draft; `work` is the box's top section (live
 * asks, staged Work), `pickers` the provider and document pickers, `state` the run's. */
export function ThreadComposer({
  handle,
  pickers,
  state,
  work,
  initialDraft = EMPTY_CHAT_DRAFT,
}: {
  handle: ChatHandle;
  pickers: (open: boolean) => ReactNode;
  state?: ReactNode;
  work?: ReactNode;
  initialDraft?: ChatDraft;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const { chat, providers, config, currentThreadId, threads, draft: head } = useWorkbench();
  // Loaded and none ready: the composer carries the first-open doors and Send says why it waits.
  const noneReady = providers.list !== undefined && !providers.list.some(isReady);
  // Some ready, but not the one this head runs on: that provider carries its own repair.
  const headId = currentThreadId
    ? chat.providerId || threads.find((item) => item.id === currentThreadId)?.providerId
    : head.providerId;
  const unready = noneReady ? undefined : providers.list?.find((item) => item.id === headId);
  const repairing = unready && !isReady(unready) ? unready : undefined;
  const isRunning = selectRunStatus(chat) !== "idle";
  const variant = useSurfaceHost().shell.mount === "compact" ? "compact" : "full";
  const box = useRef<ComposerHandle>(null);
  const send = useSend(handle, draft, (sent) => {
    setDraft((current) => (current === sent ? EMPTY_CHAT_DRAFT : current));
    box.current?.rest();
  });
  const files = useAttachments(draft, setDraft);
  const commands = useMemo<SlashCommand[]>(() => selectSkillCommands(chat), [chat]);
  const slash = useSlashMenu(draft.text, commands);
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  const form = area?.form ?? null;
  // Documents come from the live inventory, never the catalog read at mount.
  const machine = previousOf(handle.readings.machine as Reading<Machine>);
  const catalog = useMemo(() => {
    const read = capabilityCatalogSchema.safeParse(previousOf(handle.readings.capabilities)).data;
    return read && machine && liveCatalog(read, machine);
  }, [handle.readings.capabilities, machine]);
  const mentions = useMentions(draft, setDraft, catalog, area, slash.open);
  const setText = (text: string) => setDraft((previous) => withText(previous, text));
  const sendCurrent = () => void send.run();
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
          ref={box}
          variant={variant}
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
                items={mentions.rows}
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
              {files.refusal ? <div data-tone="caution">{files.refusal}</div> : null}
            </>
          }
          pickers={pickers}
          tools={
            <>
              {state}
              {noneReady ? <span data-tone="caution">no provider is ready</span> : null}
              <SituationAction
                handle={handle}
                name="fork"
                action={handle.actions.fork}
                icon={GitFork}
              />
              <Button
                kind="framed"
                icon={Paperclip}
                label="Attach files: images and text, 5 MB each, 10 a message"
                onClick={files.browse}
              />
              <input {...files.fileInputProps} />
            </>
          }
          send={
            isRunning ? (
              <SituationAction
                handle={handle}
                name="stop"
                action={handle.actions.stop}
                icon={Square}
                tone="alarm"
              />
            ) : (
              <SituationAction handle={handle} name="send" action={send} commit icon={ArrowUp} />
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
            noneReady ? "no provider is ready" : "Ask Pea; / for a skill, @ to point at a thing"
          }
          autoFocus
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
      </ComposerFrame>
    </Pane>
  );
}
