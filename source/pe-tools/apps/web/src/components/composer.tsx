import {
  useMemo,
  useRef,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { ControlChips } from "#/components/control-chips";
import { Textarea } from "#/components/ui/textarea";
import { useWorkbench, type WorkbenchAttachment } from "#/workbench/provider";
import { selectSkillCommands } from "#/workbench/chat-state";
import type { Mode } from "#/workbench/depth";
import { Press } from "#/components/lang/press";

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
  topBar,
}: {
  setMode: (mode: Mode) => void;
  /** Rendered flush at the top edge of the box — the inline budget/progress bar. */
  topBar?: ReactNode;
}) {
  const { store, chat, sendPrompt, cancel, isRunning, operationError, newThread, forkThread } =
    useWorkbench();
  const { text, attachments } = useAtomValue(store.atoms.draft);
  const setText = (value: string) =>
    store.actions.setDraft((previous) => ({ ...previous, text: value }));
  const setAttachments = (
    value: WorkbenchAttachment[] | ((previous: WorkbenchAttachment[]) => WorkbenchAttachment[]),
  ) =>
    store.actions.setDraft((previous) => ({
      ...previous,
      attachments: typeof value === "function" ? value(previous.attachments) : value,
    }));
  const fileRef = useRef<HTMLInputElement>(null);

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
  const showMenu = slash !== undefined && !text.includes(" ") && matches.length > 0;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isRunning;

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
    if (!canSend) return;
    const payload = attachments;
    setText("");
    setAttachments([]);
    void sendPrompt(trimmed, payload.length ? payload : undefined);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendCurrent();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (showMenu && event.key === "Tab") {
      event.preventDefault();
      const first = matches[0];
      if (first) pick(first);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrent();
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next = await Promise.all(Array.from(files).map(readAttachment));
    setAttachments((previous) => [...previous, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <form onSubmit={submit} className="relative w-full">
      {showMenu ? (
        <div
          role="listbox"
          aria-label="Commands"
          className="absolute bottom-full mb-2 w-full overflow-hidden rounded-sm border-[0.5px] border-line-2 on-artifact"
        >
          {matches.slice(0, 6).map((command) => (
            <Press
              key={`${command.kind}:${command.name}`}
              type="button"
              onClick={() => pick(command)}
              layout="baseline"
            >
              {/* a slash command is a machine identifier — mono */}
              <span className="t-value face-mono text-ink">/{command.name}</span>
              <span className="truncate t-label text-ink-2">{command.description}</span>
            </Press>
          ))}
        </div>
      ) : null}

      {/* Hard-edged instrument panel: the composer is a machine-operated object carrying state
          (draft, attachments, the in-flight run), so it wears the artifact treatment — one
          ground shift plus one quiet hairline. The card clips its children, so the budget bar
          stays a flush rectangle under the boundary. */}
      <div className="overflow-hidden rounded-sm border-[0.5px] border-line-2 on-artifact">
        {topBar}

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachments.map((attachment, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 rounded-sm border-[0.5px] border-line bg-recess px-2 py-0.5 t-label text-ink-2"
              >
                {attachment.name ?? "attachment"}
                <Press
                  type="button"
                  title="Remove"
                  onClick={() =>
                    setAttachments((previous) =>
                      previous.filter((_, position) => position !== index),
                    )
                  }
                >
                  <X className="size-3" />
                </Press>
              </span>
            ))}
          </div>
        ) : null}

        <div className="p-2">
          <Textarea
            name="input"
            placeholder="Ask Pea…  ( / for commands )"
            rows={1}
            autoFocus
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={onKeyDown}
            className="max-h-48 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {/* Control row: attachments + session controls (model/access) left, send right. */}
          <div className="flex items-center gap-1 pt-1">
            <Press
              tone="neutral"
              size="icon-sm"
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
            <span className="flex-1" />
            {isRunning ? (
              <Press tone="artifact" size="icon-sm" title="Stop" aria-label="Stop" onClick={cancel}>
                <Square className="size-3.5" />
              </Press>
            ) : (
              <Press
                tone="artifact"
                size="icon-sm"
                state="disabled-faint"
                title="Send"
                aria-label="Send message"
                disabled={!canSend}
                onClick={sendCurrent}
              >
                <ArrowUp className="size-4" />
              </Press>
            )}
          </div>
        </div>
        {/* a failed operation is an ERROR (caution) — the alarm is reserved for disagreement */}
        {operationError ? (
          <span className="block px-3 pb-2 t-label text-caution">{operationError}</span>
        ) : null}
      </div>
    </form>
  );
}

async function readAttachment(file: File): Promise<WorkbenchAttachment> {
  const textual =
    file.type.startsWith("text/") ||
    /\.(md|txt|json|jsonc|csv|tsv|ts|tsx|js|jsx|cs|py|rb|go|rs|java|yaml|yml|toml|xml|html|css)$/i.test(
      file.name,
    );
  if (textual) {
    return { name: file.name, mimeType: file.type || "text/plain", text: await file.text() };
  }
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    data: base64FromBuffer(await file.arrayBuffer()),
  };
}

function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
