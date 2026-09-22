import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Paperclip, X } from "lucide-react";
import { ControlChips } from "#/chat/control-chips";
import { Textarea } from "#/components/lang/textarea";
import { Pane, type PaneShortcut } from "#/components/lang/pane";
import { useWorkbench } from "#/workbench/provider";
import { EMPTY_CHAT_DRAFT, type ChatDraft, type WorkbenchAttachment } from "#/workbench/prompt";
import { formatBytes, selectRunStatus, selectSkillCommands } from "#/workbench/chat-state";
import { Press } from "#/components/lang/press";
import { chipRecipe } from "#/components/lang/chip";
import { filterItems, type Collection } from "#/components/lang/collection";
import { ListPopup } from "#/components/lang/list-popup";
import { Thumbnail } from "#/workbench/thumbnail";
import { useSend, type ChatHandle } from "#/chat/composer-head";
import { SituationAction } from "#/route/situation";

/** A skill the thread's inspect lists: the one thing the slash menu offers. `new` and `fork` are
 * route verbs (`chat/manifest.ts`); mode switches are the mode dial. */
interface SlashCommand {
  name: string;
  description: string;
}

export function Composer({
  handle,
  topBar,
  draft,
  setDraft,
}: {
  /** The route handle; Enter runs its Send verb scoped to this draft, the head draws the same. */
  handle: ChatHandle;
  /** Rendered flush at the top edge of the box — the composer head and the budget bar. */
  topBar?: ReactNode;
  draft: ChatDraft;
  setDraft: Dispatch<SetStateAction<ChatDraft>>;
}) {
  const { chat } = useWorkbench();
  const isRunning = selectRunStatus(chat) !== "idle";
  const { text, attachments } = draft;
  const send = useSend(handle, draft, (sent) =>
    setDraft((current) => (current === sent ? EMPTY_CHAT_DRAFT : current)),
  );
  const setText = (value: string) => {
    setDraft((previous) => ({ ...previous, text: value }));
  };
  const setAttachments = (
    value: WorkbenchAttachment[] | ((previous: WorkbenchAttachment[]) => WorkbenchAttachment[]),
  ) => {
    const update = (previous: { text: string; attachments: WorkbenchAttachment[] }) => ({
      ...previous,
      attachments: typeof value === "function" ? value(previous.attachments) : value,
    });
    setDraft(update);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const addFiles = async (list: ArrayLike<File>) => {
    const { admitted, refusal } = admitFiles(Array.from(list), attachments.length);
    setRefusal(refusal);
    if (admitted.length === 0) return;
    const next = await Promise.all(admitted.map(readAttachment));
    setAttachments((previous) => [...previous, ...next]);
  };
  // A file dropped anywhere else must not navigate the tab to it.
  useEffect(() => {
    const guard = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
  const carriesFiles = (event: ReactDragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");
  const onDragOver = (event: ReactDragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragging(true);
  };
  const [area, setArea] = useState<HTMLTextAreaElement | null>(null);
  const [menuDismissed, setMenuDismissed] = useState(false);
  // The slash menu's keys are the list's (R14); Tab also picks, so the composer reads its cursor.
  const menu = useRef<Collection<SlashCommand> | null>(null);

  const commands = useMemo<SlashCommand[]>(() => selectSkillCommands(chat.inspect), [chat.inspect]);
  const slash = text.startsWith("/") ? text.slice(1).split(/\s+/)[0]!.toLowerCase() : undefined;
  const showMenu =
    !menuDismissed &&
    slash !== undefined &&
    !text.includes(" ") &&
    filterItems(commands, (command) => command.name, "substring", slash).length > 0;

  const pick = (command: SlashCommand) => setText(`Use the ${command.name} skill: `);

  const sendCurrent = () => {
    void send.run();
  };

  const paneOwnsFocus = () =>
    document.activeElement === formRef.current?.closest<HTMLElement>("[data-slot='pane']");
  const beginSlashCommand = () => {
    if (!paneOwnsFocus()) return;
    if (!text) setText("/");
    formRef.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  };
  const shortcuts: PaneShortcut[] = [
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
      callback: beginSlashCommand,
      options: { preventDefault: false, stopPropagation: false },
    },
  ];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendCurrent();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (showMenu) {
      // ↑/↓, Enter and Escape belong to the open list; Tab is the composer's second pick key.
      if (event.key === "Tab" && !event.shiftKey && menu.current?.cursor) {
        event.preventDefault();
        menu.current.pick(menu.current.cursor);
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrent();
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    await addFiles(files);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <Pane
      kind="content"
      scroll="visible"
      flush
      id="composer"
      title="composer"
      help="Drafts stay with their visited thread until sent or deleted."
      headerSurface="recess"
      boundary={false}
      headerless
      shortcuts={shortcuts}
    >
      <form ref={formRef} onSubmit={submit} className="relative w-full">
        <ListPopup<SlashCommand>
          anchor="caret"
          caret={area}
          owner={area}
          open={showMenu}
          onOpenChange={(open) => (open ? undefined : setMenuDismissed(true))}
          query={slash ?? ""}
          onCollection={(collection) => (menu.current = collection)}
          aria-label="Commands"
          items={commands}
          keyOf={(command) => command.name}
          labelOf={(command) => command.name}
          filter="substring"
          empty="no skills in this thread"
          maxHeight="13rem"
          onPick={pick}
          row={(command) => ({
            // a slash command is a machine identifier — mono
            label: <span className="face-mono">/{command.name}</span>,
            meta: command.description,
          })}
        />

        {/* The composer is a box on the artifact ground — a closed edge all the way around, so the
          input reads as a place you write rather than a strip the transcript ran into. */}
        {/* Files dropped anywhere on the box attach; while a file drag is over it, the box takes
          the recess ground. */}
        <div
          className="hairline-x-faint hairline-y-faint overflow-hidden rounded-sm"
          data-surface={dragging ? "recess" : "artifact"}
          data-drop-zone=""
          onDragEnter={onDragOver}
          onDragOver={onDragOver}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragging(false);
          }}
          onDrop={(event) => {
            if (!carriesFiles(event)) return;
            event.preventDefault();
            setDragging(false);
            void addFiles(event.dataTransfer.files);
          }}
        >
          {topBar}

          {attachments.length > 0 ? (
            <div className="flex flex-wrap items-end gap-1.5 px-3 pt-3">
              {attachments.map((attachment, index) => (
                <AttachmentChip
                  key={index}
                  attachment={attachment}
                  onRemove={() =>
                    setAttachments((previous) =>
                      previous.filter((_, position) => position !== index),
                    )
                  }
                />
              ))}
            </div>
          ) : null}
          {refusal ? (
            <div className="px-3 pt-2 t-small" data-tone="caution">
              {refusal}
            </div>
          ) : null}

          <div className="p-2 px-2 py-1.5">
            <Textarea
              name="input"
              aria-label="Message"
              ref={setArea}
              aria-autocomplete="list"
              aria-haspopup="listbox"
              size="compact"
              surface="embedded"
              placeholder="Ask Pea…  ( / for skills )"
              rows={1}
              autoFocus
              value={text}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setMenuDismissed(false);
              }}
              onKeyDown={onKeyDown}
              onPaste={(event) => {
                const files = event.clipboardData.files;
                if (files.length === 0) return;
                event.preventDefault();
                void addFiles(files);
              }}
            />
            {/* Control row: attachments + session controls (model/access), then Send — the same
              manifest verb Enter runs, with the Situation's flag (moved here from the head,
              2026-09-14: a composer's send belongs beside its text). */}
            <div className="flex items-center gap-1.5 pt-1">
              <Press
                tone="quiet"
                size="icon"
                title="Attach files"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Press>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(event) => void onFiles(event.currentTarget.files)}
              />
              {/* Thread verbs: the same route actions the shell lists, refusals shown the same way. */}
              <SituationAction handle={handle} name="new" action={handle.actions.new} />
              <SituationAction handle={handle} name="fork" action={handle.actions.fork} />
              <ControlChips />
              <span className="ml-auto flex items-center gap-1.5">
                {isRunning ? (
                  <SituationAction handle={handle} name="cancel" action={handle.actions.cancel} />
                ) : null}
                <SituationAction handle={handle} name="send" action={send} commit />
              </span>
            </div>
          </div>
        </div>
      </form>
    </Pane>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: WorkbenchAttachment;
  onRemove: () => void;
}) {
  const { base, label, count } = chipRecipe();
  const name = attachment.name ?? "attachment";
  return (
    <span
      className={base({
        class:
          attachment.data && attachment.mimeType?.startsWith("image/")
            ? "h-auto py-[3px]"
            : undefined,
      })}
      data-surface="artifact"
      title={`${name} is attached to the next message`}
    >
      {attachment.data && attachment.mimeType?.startsWith("image/") ? (
        <Thumbnail
          src={`data:${attachment.mimeType};base64,${attachment.data}`}
          name={name}
          fit="chip"
        />
      ) : null}
      <span className={label()}>{name}</span>
      {!(attachment.data && attachment.mimeType?.startsWith("image/")) &&
      attachment.size !== undefined ? (
        <span className={count()}>{formatBytes(attachment.size)}</span>
      ) : null}
      <Press type="button" tone="quiet" title={`Remove ${name}`} onClick={onRemove}>
        <X className="size-3" />
      </Press>
    </span>
  );
}

// ponytail: our own ceiling, 5 MB a file and 10 a message; the model provider's limit is the real
// authority. Raise these when a provider accepts more and users hit them.
const ATTACHMENT_LIMITS = { fileBytes: 5 * 1024 * 1024, files: 10 };

/** The one attachment rule: which files fit beside `held` ones, and one line naming the rest. */
function admitFiles(files: File[], held: number): { admitted: File[]; refusal?: string } {
  const admitted: File[] = [];
  const tooBig: string[] = [];
  const tooMany: string[] = [];
  for (const file of files) {
    if (file.size > ATTACHMENT_LIMITS.fileBytes) tooBig.push(file.name);
    else if (held + admitted.length >= ATTACHMENT_LIMITS.files) tooMany.push(file.name);
    else admitted.push(file);
  }
  const reasons = [
    tooBig.length
      ? `${tooBig.join(", ")} (over the ${ATTACHMENT_LIMITS.fileBytes / 1024 / 1024} MB limit per file)`
      : "",
    tooMany.length
      ? `${tooMany.join(", ")} (${ATTACHMENT_LIMITS.files} files per message at most)`
      : "",
  ].filter(Boolean);
  return { admitted, refusal: reasons.length ? `Not added: ${reasons.join("; ")}` : undefined };
}

async function readAttachment(file: File): Promise<WorkbenchAttachment> {
  const textual =
    file.type.startsWith("text/") ||
    /\.(md|txt|json|jsonc|csv|tsv|ts|tsx|js|jsx|cs|py|rb|go|rs|java|yaml|yml|toml|xml|html|css)$/i.test(
      file.name,
    );
  if (textual) {
    return {
      name: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      text: await file.text(),
    };
  }
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    data: base64FromBuffer(await file.arrayBuffer()),
  };
}

export function ThreadComposer({
  handle,
  topBar,
  initialDraft = EMPTY_CHAT_DRAFT,
}: {
  handle: ChatHandle;
  topBar?: ReactNode;
  initialDraft?: ChatDraft;
}) {
  const [draft, setDraft] = useState(initialDraft);
  return <Composer handle={handle} topBar={topBar} draft={draft} setDraft={setDraft} />;
}

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
