import { chatStyles } from "#/components/lang/chat-appearance";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useAtomValue } from "@effect/atom-react";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { ControlChips } from "#/chat/control-chips";
import { Textarea } from "#/components/lang/textarea";
import { useWorkbench, type WorkbenchAttachment } from "#/workbench/provider";
import { selectSkillCommands } from "#/workbench/chat-state";
import type { Mode } from "#/workbench/depth";
import { Press } from "#/components/lang/press";
import { PressContent } from "#/components/anatomy/press-content";
import { cn } from "#/lib/utils";

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
    if (showMenu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveCommand((current) =>
          (current + step + visibleMatches.length) % visibleMatches.length,
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
    const next = await Promise.all(Array.from(files).map(readAttachment));
    setAttachments((previous) => [...previous, ...next]);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <form onSubmit={submit} className={chatStyles.composer0()}>
      {showMenu ? (
        <div
          id={menuId}
          role="listbox"
          aria-label="Commands"
          className={cn(
            chatStyles.composer1(),
            "right-2 left-2 z-[8] mb-1.5 max-h-52 w-auto overflow-x-hidden overflow-y-auto p-1 shadow-sm [&>button]:w-full",
          )}
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
                <span className={chatStyles.composer2()}>/{command.name}</span>
                <span className={chatStyles.composer3()}>{command.description}</span>
              </PressContent>
            </Press>
          ))}
        </div>
      ) : null}

      {/* The composer carries state, but it belongs to the transcript rather than floating as a
          second card. One top rule and the artifact ground separate input from history. */}
      <div
        className={cn(
          chatStyles.composer4(),
          "overflow-visible rounded-none border-x-0 border-b-0",
        )}
      >
        {topBar}

        {attachments.length > 0 ? (
          <div className={chatStyles.composer5()}>
            {attachments.map((attachment, index) => (
              <span key={index} className={chatStyles.composer6()}>
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
                  <X className={chatStyles.composer7()} />
                </Press>
              </span>
            ))}
          </div>
        ) : null}

        <div className={cn(chatStyles.composer8(), "px-2 py-1.5")}>
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
          />
          {/* Control row: attachments + session controls (model/access) left, send right. */}
          <div className={cn(chatStyles.composer9(), "gap-1.5")}>
            <Press
              tone="quiet"
              size="icon"
              title="Attach files"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip className={chatStyles.composer10()} />
            </Press>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(event) => void onFiles(event.currentTarget.files)}
            />
            <ControlChips />
            <span className={chatStyles.composer11()} />
            {isRunning ? (
              <Press tone="neutral" size="icon" title="Stop" aria-label="Stop" onClick={cancel}>
                <Square className={chatStyles.composer12()} />
              </Press>
            ) : (
              <Press
                tone="neutral"
                size="icon"
                state="disabled"
                title="Send"
                aria-label="Send message"
                disabled={!canSend}
                onClick={sendCurrent}
              >
                <ArrowUp className={chatStyles.composer13()} />
              </Press>
            )}
          </div>
        </div>
        {/* a failed operation is an ERROR (caution) — the alarm is reserved for disagreement */}
        {operationError ? <span className={chatStyles.composer14()}>{operationError}</span> : null}
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
