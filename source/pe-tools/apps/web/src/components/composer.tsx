import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import type { WorkbenchState } from "@pe/agent-contracts";
import { Button } from "#/components/ui/button";
import { Textarea } from "#/components/ui/textarea";
import { useWorkbench, type WorkbenchAttachment } from "#/workbench/provider";
import type { Mode } from "#/workbench/depth";
import { PROMPT_MAX } from "#/routes/chat";

interface SlashCommand {
  name: string;
  description: string;
  kind: "builtin" | "skill";
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "new", description: "Start a new thread", kind: "builtin" },
  { name: "fork", description: "Fork this conversation into a new thread", kind: "builtin" },
  { name: "threads", description: "Show the thread list", kind: "builtin" },
  { name: "trace", description: "Show the trace gutter", kind: "builtin" },
  { name: "world", description: "Show the context world inspector", kind: "builtin" },
];

export function Composer({
  setMode,
  promptSeed,
  topBar,
}: {
  setMode: (mode: Mode) => void;
  /** Initial draft from the URL `prompt` param (read once on mount, then cleared from the URL). */
  promptSeed?: string;
  /** Rendered flush at the top edge of the box — the inline budget/progress bar. */
  topBar?: ReactNode;
}) {
  const { debug, sendPrompt, cancel, isRunning, operationError, readOnly, newThread, forkThread } =
    useWorkbench();
  const navigate = useNavigate({ from: "/chat" });
  const [text, setText] = useState(promptSeed ?? "");
  const [attachments, setAttachments] = useState<WorkbenchAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Clear the seed from the URL once consumed — it lives in composer state from here on.
  useEffect(() => {
    if (promptSeed)
      void navigate({ search: (prev) => ({ ...prev, prompt: undefined }), replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror short drafts back to the URL (debounced). Drop the param past PROMPT_MAX or whenever
  // attachments are present — those never serialize. Still goes through the router, never raw history.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = text.trim();
      const keep = next.length > 0 && next.length <= PROMPT_MAX && attachments.length === 0;
      void navigate({
        search: (prev) => ({ ...prev, prompt: keep ? next : undefined }),
        replace: true,
      });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [text, attachments.length, navigate]);

  const commands = useMemo<SlashCommand[]>(
    () => [
      ...BUILTIN_COMMANDS,
      ...readSkillCommands(debug.state).map((skill): SlashCommand => ({ ...skill, kind: "skill" })),
    ],
    [debug.state],
  );
  const slash = text.startsWith("/") ? text.slice(1).split(/\s+/)[0]!.toLowerCase() : undefined;
  const matches =
    slash !== undefined
      ? commands.filter((command) => command.name.toLowerCase().startsWith(slash))
      : [];
  const showMenu = slash !== undefined && !text.includes(" ") && matches.length > 0;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isRunning && !readOnly;

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
          className="absolute bottom-full mb-2 w-full overflow-hidden rounded-xl border border-border bg-popover shadow-lg"
        >
          {matches.slice(0, 6).map((command) => (
            <button
              key={`${command.kind}:${command.name}`}
              type="button"
              onClick={() => pick(command)}
              className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-muted"
            >
              <span className="text-sm font-medium text-foreground">/{command.name}</span>
              <span className="truncate text-xs text-muted-foreground">{command.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* The card clips its own children, so the budget bar is a plain flush rectangle inlaid under
          the rounded boundary — the border does the corner-clipping, the bar needs no rounding. */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card/95 shadow-lg shadow-black/5 backdrop-blur">
        {topBar}

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {attachments.map((attachment, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {attachment.name ?? "attachment"}
                <button
                  type="button"
                  title="Remove"
                  onClick={() =>
                    setAttachments((previous) =>
                      previous.filter((_, position) => position !== index),
                    )
                  }
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center gap-1 p-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            title="Attach files"
            onClick={() => fileRef.current?.click()}
          >
            <Paperclip className="size-4" />
          </Button>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(event) => void onFiles(event.currentTarget.files)}
          />
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
          {isRunning ? (
            <Button type="button" size="icon" title="Stop" aria-label="Stop" onClick={cancel}>
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              title="Send"
              aria-label="Send message"
              disabled={!canSend}
              onClick={sendCurrent}
            >
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
        {operationError ? (
          <span className="block px-3 pb-2 text-xs text-destructive">{operationError}</span>
        ) : null}
      </div>
    </form>
  );
}

/** Skill catalog published by the runtime via `agent.info.metadata.commands`. */
function readSkillCommands(state: WorkbenchState): { name: string; description: string }[] {
  const commands = state.agent.info?.metadata?.commands;
  if (!Array.isArray(commands)) return [];
  return commands.flatMap((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string") return [];
    return [
      {
        name: record.name,
        description: typeof record.description === "string" ? record.description : "skill",
      },
    ];
  });
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
