import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import { Paperclip, X } from "lucide-react";
import { ControlChips } from "#/chat/control-chips";
import { Textarea } from "#/components/lang/textarea";
import { useWorkbench, type WorkbenchAttachment } from "#/workbench/provider";
import { selectRunStatus, selectSkillCommands } from "#/workbench/chat-state";
import type { Mode } from "#/workbench/depth";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";
import { chipRecipe } from "#/components/lang/chip";
import { cn } from "#/lib/utils";
import { useSend, type ChatHandle } from "#/chat/composer-head";
import { SituationAction } from "#/route/situation";

interface SlashCommand {
  name: string;
  description: string;
  kind: "builtin" | "skill";
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "new", description: "Start a new thread", kind: "builtin" },
  { name: "fork", description: "Fork this thread", kind: "builtin" },
  { name: "threads", description: "Show the thread list", kind: "builtin" },
  { name: "trace", description: "Show the trace gutter", kind: "builtin" },
  { name: "world", description: "Show the context world inspector", kind: "builtin" },
];

export function Composer({
  setMode,
  handle,
  topBar,
}: {
  setMode: (mode: Mode) => void;
  /** The route handle; Enter runs its Send verb scoped to this draft, the head draws the same. */
  handle: ChatHandle;
  /** Rendered flush at the top edge of the box — the composer head and the budget bar. */
  topBar?: ReactNode;
}) {
  const { store, chat, newThread, forkThread } = useWorkbench();
  const isRunning = selectRunStatus(chat) !== "idle";
  const liveDraft = useAtomValue(store.atoms.draft);
  const draft = liveDraft;
  const { text, attachments } = draft;
  const send = useSend(handle, draft);
  const setText = (value: string) => {
    store.actions.setDraft((previous) => ({ ...previous, text: value }));
  };
  const setAttachments = (
    value: WorkbenchAttachment[] | ((previous: WorkbenchAttachment[]) => WorkbenchAttachment[]),
  ) => {
    const update = (previous: { text: string; attachments: WorkbenchAttachment[] }) => ({
      ...previous,
      attachments: typeof value === "function" ? value(previous.attachments) : value,
    });
    store.actions.setDraft(update);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const addFiles = async (list: ArrayLike<File>) => {
    const { admitted, refusal } = admitFiles(Array.from(list), attachments.length);
    setRefusal(refusal);
    if (admitted.length === 0) return;
    const next = await Promise.all(admitted.map(readAttachment));
    setAttachments((previous) => [...previous, ...next]);
  };
  // A thumbnail's object URL lives exactly as long as its chip: removed or sent, it is revoked.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const live = new Set(attachments.flatMap((attachment) => attachment.preview ?? []));
    for (const url of previews.current) if (!live.has(url)) URL.revokeObjectURL(url);
    previews.current = live;
  }, [attachments]);
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
  const menuId = useId();
  const [activeCommand, setActiveCommand] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);

  const commands = useMemo<SlashCommand[]>(
    () => [
      ...BUILTIN_COMMANDS,
      ...selectSkillCommands(chat.inspect).map(
        (skill): SlashCommand => ({ ...skill, kind: "skill" }),
      ),
    ],
    [chat.inspect],
  );
  const slash = text.startsWith("/") ? text.slice(1).split(/\s+/)[0]!.toLowerCase() : undefined;
  const matches =
    slash !== undefined
      ? commands.filter((command) => command.name.toLowerCase().startsWith(slash))
      : [];
  const visibleMatches = matches.slice(0, 6);
  const activeIndex = activeCommand % Math.max(visibleMatches.length, 1);
  const selectedCommand = visibleMatches[activeIndex];
  const showMenu =
    !menuDismissed && slash !== undefined && !text.includes(" ") && visibleMatches.length > 0;

  const runBuiltin = (name: string): boolean => {
    switch (name) {
      case "new":
        newThread();
        return true;
      case "fork":
        void forkThread();
        return true;
      case "threads":
      case "trace":
      case "world":
        setMode(name as Mode);
        return true;
      default:
        return false;
    }
  };

  const pick = (command: SlashCommand) => {
    if (command.kind === "builtin") {
      runBuiltin(command.name);
      setText("");
    } else {
      setText(`Use the ${command.name} skill: `);
    }
  };

  const sendCurrent = () => {
    const trimmed = text.trim();
    if (trimmed.startsWith("/")) {
      const name = trimmed.slice(1).split(/\s+/)[0]!.toLowerCase();
      if (runBuiltin(name)) {
        setText("");
        return;
      }
    }
    // Enter is the same verb as the head's Send; a refused verb stays quiet here, as it always
    // has, and the head's button is where the refusal speaks.
    if (send.refusal) return;
    void send.run();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendCurrent();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (showMenu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveCommand(
          (current) => (current + step + visibleMatches.length) % visibleMatches.length,
        );
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setMenuDismissed(true);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        if (selectedCommand) pick(selectedCommand);
        return;
      }
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
    <form onSubmit={submit} className="relative w-full">
      {showMenu ? (
        <div
          id={menuId}
          role="listbox"
          aria-label="Commands"
          className={cn(
            "hairline-x-faint hairline-y-faint absolute bottom-full mb-2 w-full overflow-hidden rounded-sm",
            "right-2 left-2 z-[8] mb-1.5 max-h-52 w-auto overflow-x-hidden overflow-y-auto p-1 shadow-sm [&>button]:w-full",
          )}
          data-surface="artifact"
        >
          {visibleMatches.map((command, index) => (
            <Press
              key={`${command.kind}:${command.name}`}
              id={`${menuId}-${index}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={index === activeIndex}
              state={index === activeIndex ? "selected" : "rest"}
              onMouseEnter={() => setActiveCommand(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(command)}
            >
              <PressContent geometry="baseline">
                {/* a slash command is a machine identifier — mono */}
                <span className="face-mono text-ink">/{command.name}</span>
                <span className="truncate t-small t-upper">{command.description}</span>
              </PressContent>
            </Press>
          ))}
        </div>
      ) : null}

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
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
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
                  setAttachments((previous) => previous.filter((_, position) => position !== index))
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
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={showMenu}
            aria-controls={showMenu ? menuId : undefined}
            aria-activedescendant={showMenu ? `${menuId}-${activeIndex}` : undefined}
            size="compact"
            surface="embedded"
            placeholder="Ask Pea…  ( / for commands )"
            rows={1}
            autoFocus
            value={text}
            onChange={(event) => {
              setText(event.currentTarget.value);
              setActiveCommand(0);
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
      className={base({ class: attachment.preview ? "h-auto py-[3px]" : undefined })}
      data-surface="artifact"
      title={`${name} is attached to the next message`}
    >
      {attachment.preview ? (
        <img src={attachment.preview} alt="" className="size-8 object-cover" />
      ) : null}
      <span className={label()}>{name}</span>
      {!attachment.preview && attachment.size !== undefined ? (
        <span className={count()}>{formatBytes(attachment.size)}</span>
      ) : null}
      <Press type="button" tone="quiet" title={`Remove ${name}`} onClick={onRemove}>
        <X className="size-3" />
      </Press>
    </span>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ponytail: our own ceiling, 5 MB a file and 10 a message; the model provider's limit is the real
// authority. Raise these when a provider accepts more and users hit them.
const ATTACHMENT_LIMITS = { fileBytes: 5 * 1024 * 1024, files: 10 };

/** The one attachment rule: which files fit beside `held` ones, and one line on why any did not. */
function admitFiles(files: File[], held: number): { admitted: File[]; refusal?: string } {
  const admitted: File[] = [];
  let refusal: string | undefined;
  for (const file of files) {
    if (file.size > ATTACHMENT_LIMITS.fileBytes)
      refusal = `${file.name} was not added: over the ${ATTACHMENT_LIMITS.fileBytes / 1024 / 1024} MB limit per file`;
    else if (held + admitted.length >= ATTACHMENT_LIMITS.files)
      refusal = `${file.name} was not added: ${ATTACHMENT_LIMITS.files} files per message at most`;
    else admitted.push(file);
  }
  return { admitted, refusal };
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
    ...(file.type.startsWith("image/") ? { preview: URL.createObjectURL(file) } : {}),
  };
}

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
