// The composer's DOM: draft box, attachments, slash and `@` menus, send. Logic lives in the hooks and `useSend`.
import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { ArrowUp, GitFork, Paperclip, Square } from "lucide-react";
import {
  capabilityCatalogSchema,
  type Capability,
  type Machine,
  type Reading,
} from "@pe/agent-contracts";
import { FirstOpenCard, ProviderRepair } from "#/chat/first-open";
import { isReady } from "#/workbench/provider/providers";
import { Textarea } from "#/components/lang/textarea";
import { Pane } from "#/components/lang/pane";
import { ScopeKeys, type ScopeKey } from "@pe/kit/keys";
import { useWorkbench } from "#/workbench/provider";
import { EMPTY_CHAT_DRAFT, type ChatDraft } from "#/workbench/prompt";
import { selectRunStatus, selectSkillCommands } from "@pe/agent-contracts/chat-state";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { useSend, type ChatHandle, type PickerFace } from "#/chat/composer-head";
import { SituationAction } from "#/route/situation-verbs";
import { ComposerBox, ComposerFrame } from "#/components/lang/conversation";
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

/** Prototype round (tray UX 2026-10-14): how the open composer draws its pickers. A: every word,
 *  in the bottom row. B: marks only, in the bottom row. C: mark and one word, kept in the left
 *  rail. At rest every variant is one line with the marks stacked on its left. */
export type ComposerVariant = "A" | "B" | "C";
const OPEN_FACE: Record<ComposerVariant, PickerFace> = { A: "control", B: "marks", C: "brief" };

/** The route handle's Enter runs Send scoped to this draft; `work` is the box's top section (live
 * asks, staged Work), `pickers` the provider and document pickers in a face, `state` the run's. */
export function ThreadComposer({
  handle,
  pickers,
  state,
  work,
  variant,
  lines,
  initialDraft = EMPTY_CHAT_DRAFT,
}: {
  handle: ChatHandle;
  pickers: (face: PickerFace) => ReactNode;
  state?: ReactNode;
  work?: ReactNode;
  variant: ComposerVariant;
  /** How tall the draft grows while open, in lines, before it scrolls. */
  lines: number;
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
  const send = useSend(handle, draft, (sent) =>
    setDraft((current) => (current === sent ? EMPTY_CHAT_DRAFT : current)),
  );
  const files = useAttachments(draft, setDraft);
  const commands = useMemo<SlashCommand[]>(() => selectSkillCommands(chat), [chat]);
  const slash = useSlashMenu(draft.text, commands);
  const [form, setForm] = useState<HTMLFormElement | null>(null);
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
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

  // Open while you write: the draft grows to `lines` and the pickers say their words. Focus leaving
  // the composer (React focus bubbles through its portalled popups) rests it at one line; a window
  // losing focus does not. The reflow is a view transition, skipped under reduced motion.
  const [open, setOpen] = useState(false);
  const rest = useRef<number>(undefined);
  // The state asked for, not the state drawn: a transition commits a frame late.
  const wanted = useRef(false);
  const flip = (next: boolean) => {
    if (next === wanted.current) return;
    wanted.current = next;
    if (!document.startViewTransition || matchMedia("(prefers-reduced-motion: reduce)").matches)
      return setOpen(next);
    document.startViewTransition(() => flushSync(() => setOpen(next)));
  };
  const hold = () => window.clearTimeout(rest.current);
  const release = () => {
    hold();
    rest.current = window.setTimeout(() => {
      if (!document.hasFocus()) return;
      flip(false);
      if (area) area.scrollTop = 0;
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendCurrent();
  };

  return (
    <Pane id="composer" scroll="visible" flush>
      <ScopeKeys keys={shortcuts} />
      <ComposerFrame>
        <form
          ref={setForm}
          onSubmit={submit}
          onFocus={hold}
          onBlur={release}
          className="relative w-full"
        >
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
          <ComposerBox
            dragging={files.dragging}
            data-compose={variant}
            data-open={open || undefined}
            style={{ "--composer-lines": lines } as CSSProperties}
            {...files.dropProps}
          >
            <div data-composer-work="">
              {work}
              {noneReady ? <FirstOpenCard providers={providers} origin={config.origin} /> : null}
              {repairing ? <ProviderRepair provider={repairing} providers={providers} /> : null}
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
            </div>
            <div data-composer-pickers="">{pickers(open ? OPEN_FACE[variant] : "icon")}</div>
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
              onFocus={() => flip(true)}
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
            <div data-composer-tools="">
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
            </div>
            {/* One slot: Stop replaces Send while a turn runs, so the two never coexist. */}
            <div data-composer-send="">
              {isRunning ? (
                <SituationAction
                  handle={handle}
                  name="stop"
                  action={handle.actions.stop}
                  icon={Square}
                  tone="alarm"
                />
              ) : (
                <SituationAction handle={handle} name="send" action={send} commit icon={ArrowUp} />
              )}
            </div>
          </ComposerBox>
        </form>
      </ComposerFrame>
    </Pane>
  );
}
