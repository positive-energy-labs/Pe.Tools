// The composer's DOM: draft box, attachments, slash and `@` menus, send. Logic lives in the hooks and `useSend`.
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowUp, GitFork, Paperclip, Square } from "lucide-react";
import { capabilityCatalogSchema, type Capability } from "@pe/agent-contracts";
import { FirstOpenCard } from "#/chat/first-open";
import { isReady } from "#/workbench/provider/providers";
import { Textarea } from "#/components/lang/textarea";
import { Pane } from "#/components/lang/pane";
import { ScopeKeys, type ScopeKey } from "#/route/keys";
import { useWorkbench } from "#/workbench/provider";
import { EMPTY_CHAT_DRAFT, type ChatDraft } from "#/workbench/prompt";
import { selectRunStatus, selectSkillCommands } from "#/workbench/chat-state";
import { ListPopup } from "#/components/lang/list-popup";
import { useSend, type ChatHandle } from "#/chat/composer-head";
import { SituationAction } from "#/route/situation-verbs";
import { ComposerBox, ComposerFrame, ComposerRow } from "#/components/lang/conversation";
import { Button } from "#/components/lang/button";
import { MentionChip } from "#/components/lang/chip";
import { previousOf, targetInventory } from "#/readings";
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
 * asks, staged Work), `controls` the bottom row's lead (pickers and state). */
export function ThreadComposer({
  handle,
  controls,
  work,
  initialDraft = EMPTY_CHAT_DRAFT,
}: {
  handle: ChatHandle;
  controls?: ReactNode;
  work?: ReactNode;
  initialDraft?: ChatDraft;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const { chat, providers, config } = useWorkbench();
  // Loaded and none ready: the composer carries the first-open doors and Send says why it waits.
  const noneReady = providers.list !== undefined && !providers.list.some(isReady);
  const isRunning = selectRunStatus(chat) !== "idle";
  const send = useSend(handle, draft, (sent) =>
    setDraft((current) => (current === sent ? EMPTY_CHAT_DRAFT : current)),
  );
  const files = useAttachments(draft, setDraft);
  const commands = useMemo<SlashCommand[]>(() => selectSkillCommands(chat), [chat]);
  const slash = useSlashMenu(draft.text, commands);
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  // Documents come from the live inventory, never the catalog read at mount.
  const inventory = previousOf(handle.readings.inventory as Parameters<typeof targetInventory>[0]);
  const catalog = useMemo(() => {
    const read = capabilityCatalogSchema.safeParse(previousOf(handle.readings.capabilities)).data;
    return read && liveCatalog(read, inventory, new Date().toISOString());
  }, [handle.readings.capabilities, inventory]);
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
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendCurrent();
  };

  return (
    <Pane id="composer" scroll="visible" flush>
      <ScopeKeys keys={shortcuts} />
      <ComposerFrame>
        <form ref={setForm} onSubmit={submit} className="relative w-full">
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
          {/* Files dropped anywhere on the box attach; a file drag over it takes the recess ground. */}
          <ComposerBox dragging={files.dragging} {...files.dropProps}>
            {work}
            {noneReady ? <FirstOpenCard providers={providers} origin={config.origin} /> : null}
            {files.attachments.length > 0 || draft.mentions.length > 0 ? (
              <div className="flex flex-wrap items-end gap-1.5 px-(--gutter) pt-(--gutter)">
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
            {files.refusal ? (
              <div className="px-(--gutter) pt-2" data-tone="caution">
                {files.refusal}
              </div>
            ) : null}
            <Textarea
              name="input"
              aria-label="Message"
              ref={setArea}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              surface="embedded"
              placeholder={
                noneReady ? "no provider is ready" : "Ask Pea; / for a skill, @ to point at a thing"
              }
              rows={1}
              autoFocus
              value={draft.text}
              onChange={(event) => {
                setText(event.currentTarget.value);
                mentions.onCaret(event.currentTarget.selectionStart);
                slash.reset();
                mentions.reset();
              }}
              onSelect={(event) => mentions.onCaret(event.currentTarget.selectionStart)}
              onKeyDown={(event) => {
                if (
                  event.nativeEvent.isComposing ||
                  slash.onKeyDown(event) ||
                  mentions.onKeyDown(event)
                )
                  return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  sendCurrent();
                }
              }}
              onPaste={files.pasteHandler}
            />
            <input {...files.fileInputProps} />
            <ComposerRow
              lead={controls}
              trail={
                <>
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
                  {isRunning ? (
                    <SituationAction
                      handle={handle}
                      name="stop"
                      action={handle.actions.stop}
                      icon={Square}
                      tone="alarm"
                    />
                  ) : null}
                  <SituationAction
                    handle={handle}
                    name="send"
                    action={send}
                    commit
                    icon={ArrowUp}
                  />
                </>
              }
            />
          </ComposerBox>
        </form>
      </ComposerFrame>
    </Pane>
  );
}
