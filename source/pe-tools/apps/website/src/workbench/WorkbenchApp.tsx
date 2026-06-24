import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  selectWorkbenchChrome,
  type WorkbenchAccessLevel,
  type WorkbenchState,
} from "@pe/agent-contracts";
import { ArrowUp, ChevronDown, Paperclip, Plus, Search, Square, X } from "lucide-react";
import {
  WorkbenchProvider,
  useWorkbench,
  type StoredThreadSummary,
  type WorkbenchAttachment,
} from "./WorkbenchProvider.tsx";
import { Lens } from "./Lens.tsx";
import { MODE_HINT, MODES, useMode, type Mode } from "./depth.ts";
import { WorkbenchRuntimeProvider } from "./aui.tsx";

export function WorkbenchApp() {
  return (
    <WorkbenchProvider>
      <WorkbenchRuntimeProvider>
        <Surface />
      </WorkbenchRuntimeProvider>
    </WorkbenchProvider>
  );
}

function Surface() {
  const {
    debug,
    threads,
    currentThreadId,
    operation,
    operationError,
    readOnly,
    takeOverThread,
    newThread,
    switchThread,
    deleteThread,
  } = useWorkbench();
  const [mode, setMode] = useMode();
  const [paletteOpen, setPaletteOpen] = useState(false);

  const chrome = useMemo(() => selectWorkbenchChrome(debug.state), [debug.state]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
      if (event.key === "Escape") setPaletteOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <main className="mg-app" data-mode={mode}>
      <header className="mg-header">
        <div className="mg-thread">
          <span className={`mg-dot ${chrome.status}`} title={chrome.status} />
          <span className="mg-thread-title">{chrome.threadLabel}</span>
        </div>
        <div className="mg-dial" role="group" aria-label="View depth" title={MODE_HINT[mode]}>
          {MODES.map((value) => (
            <button
              key={value}
              className="mg-seg"
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {label(value)}
            </button>
          ))}
        </div>
        <div className="mg-chiprow">
          <ControlChips />
          <button
            className="mg-chip"
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Threads (Ctrl/Cmd-K)"
          >
            <Search size={13} />
            threads
          </button>
          <button
            className="mg-iconbtn"
            type="button"
            title="New thread"
            onClick={() => newThread()}
          >
            <Plus size={15} />
          </button>
        </div>
      </header>

      <div className="mg-status-slot" aria-live="polite">
        {readOnly ? (
          <div className="mg-status readonly">
            <span>This thread is open in another tab — read-only here.</span>
            <button type="button" className="mg-takeover" onClick={() => takeOverThread()}>
              Take over
            </button>
          </div>
        ) : debug.loading || debug.error || operation || operationError ? (
          <div className={`mg-status ${debug.error || operationError ? "error" : "loading"}`}>
            <span>{debug.error ?? operationError ?? operation ?? "Loading thread state"}</span>
          </div>
        ) : null}
      </div>

      <Lens state={debug.state} mode={mode} />

      <div className="mg-composer-wrap">
        <Composer setMode={setMode} />
      </div>

      {paletteOpen ? (
        <ThreadPalette
          threads={threads}
          currentThreadId={currentThreadId}
          onSelect={(id) => {
            setPaletteOpen(false);
            void switchThread(id);
          }}
          onNew={() => {
            setPaletteOpen(false);
            newThread();
          }}
          onDelete={(id) => void deleteThread(id)}
          onClose={() => setPaletteOpen(false)}
        />
      ) : null}
    </main>
  );
}

function label(mode: Mode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

interface PickerOption {
  id: string;
  name: string;
  hint?: string;
}

function ControlChips() {
  const { debug, setModel, setAccessLevel } = useWorkbench();
  const { models, access } = debug.state;
  const modelLabel = models.currentModelId
    ? (models.availableModels.find((item) => item.id === models.currentModelId)?.displayName ??
      models.currentModelId)
    : "model";
  const accessLabel =
    access.availableAccessLevels.find((item) => item.id === access.currentAccessLevel)?.name ??
    access.currentAccessLevel ??
    "access";
  return (
    <>
      <Picker
        title="Model"
        label={modelLabel}
        activeId={models.currentModelId}
        options={models.availableModels.map((item) => ({
          id: item.id,
          name: item.displayName ?? item.id,
          hint: item.provider,
        }))}
        onPick={(id) => void setModel(id)}
      />
      <Picker
        title="Access"
        label={accessLabel}
        activeId={access.currentAccessLevel}
        options={access.availableAccessLevels.map((item) => ({
          id: item.id,
          name: item.name,
          hint: item.description,
        }))}
        onPick={(id) => void setAccessLevel(id as WorkbenchAccessLevel)}
      />
    </>
  );
}

function Picker({
  title,
  label,
  activeId,
  options,
  onPick,
}: {
  title: string;
  label: string;
  activeId?: string;
  options: PickerOption[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (options.length === 0) return <span className="mg-chip muted">{label}</span>;
  return (
    <div className="mg-picker">
      <button
        className="mg-chip interactive"
        type="button"
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-expanded={open}
      >
        {label}
        <ChevronDown size={11} />
      </button>
      {open ? (
        <>
          <div className="mg-picker-scrim" onClick={() => setOpen(false)} role="presentation" />
          <div className="mg-picker-menu" role="listbox" aria-label={title}>
            <div className="mg-picker-head">{title}</div>
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === activeId}
                className={`mg-picker-opt ${option.id === activeId ? "active" : ""}`}
                onClick={() => {
                  onPick(option.id);
                  setOpen(false);
                }}
              >
                <span className="t">{option.name}</span>
                {option.hint ? <span className="s">{option.hint}</span> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

interface SlashCommand {
  name: string;
  description: string;
  kind: "builtin" | "skill";
}

const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "new", description: "Start a new thread", kind: "builtin" },
  { name: "fork", description: "Fork this conversation into a new thread", kind: "builtin" },
  { name: "chat", description: "Hide the gutters", kind: "builtin" },
  { name: "trace", description: "Show the trace gutter", kind: "builtin" },
];

function Composer({ setMode }: { setMode: (mode: Mode) => void }) {
  const { debug, sendPrompt, cancel, isRunning, operationError, readOnly, newThread, forkThread } =
    useWorkbench();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<WorkbenchAttachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

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
      case "chat":
      case "trace":
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
    <form className={`mg-composer ${isRunning ? "running" : ""}`} onSubmit={submit}>
      {showMenu ? (
        <div className="mg-slash" role="listbox" aria-label="Commands">
          {matches.slice(0, 6).map((command) => (
            <button
              key={`${command.kind}:${command.name}`}
              type="button"
              className={`mg-slash-opt ${command.kind}`}
              onClick={() => pick(command)}
            >
              <span className="t">/{command.name}</span>
              <span className="s">{command.description}</span>
            </button>
          ))}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mg-attachments">
          {attachments.map((attachment, index) => (
            <span className="mg-attachment" key={index}>
              {attachment.name ?? "attachment"}
              <button
                type="button"
                title="Remove"
                onClick={() =>
                  setAttachments((previous) => previous.filter((_, position) => position !== index))
                }
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="mg-composer-row">
        <button
          className="mg-attach"
          type="button"
          title="Attach files"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(event) => void onFiles(event.currentTarget.files)}
        />
        <textarea
          name="input"
          placeholder="Ask Pea…  ( / for commands )"
          rows={1}
          autoFocus
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          style={{ resize: "none" }}
        />
        {isRunning ? (
          <button className="mg-send" type="button" title="Stop" onClick={cancel}>
            <Square size={14} />
          </button>
        ) : (
          <button
            className="mg-send"
            type="button"
            title="Send"
            disabled={!canSend}
            onClick={sendCurrent}
          >
            <ArrowUp size={17} />
          </button>
        )}
      </div>
      {operationError ? <span className="mg-composer-error">{operationError}</span> : null}
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

function ThreadPalette({
  threads,
  currentThreadId,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: {
  threads: StoredThreadSummary[];
  currentThreadId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return threads;
    return threads.filter(
      (thread) =>
        thread.title.toLowerCase().includes(needle) ||
        (thread.cwd ?? "").toLowerCase().includes(needle),
    );
  }, [query, threads]);

  return (
    <div className="mg-palette-scrim" onClick={onClose} role="presentation">
      <div
        className="mg-palette"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Threads"
      >
        <input
          autoFocus
          placeholder="Search threads…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mg-palette-list">
          <button className="mg-palette-row" type="button" onClick={onNew}>
            <span className="t" style={{ color: "var(--pe-blue)" }}>
              <Plus size={13} style={{ verticalAlign: "-2px", marginRight: "6px" }} />
              New thread
            </span>
            <span className="s">Ctrl/Cmd-K</span>
          </button>
          {filtered.map((thread) => (
            <div
              className={`mg-palette-row ${thread.id === currentThreadId ? "active" : ""}`}
              key={thread.id}
            >
              <button
                className="t"
                type="button"
                style={{ background: "none", border: "none", textAlign: "left", padding: 0 }}
                onClick={() => onSelect(thread.id)}
              >
                {thread.title}
                {thread.promptActive ? " ·  running" : ""}
              </button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                {thread.cwd ? <span className="s">{thread.cwd}</span> : null}
                <button
                  className="mg-iconbtn"
                  type="button"
                  title="Delete thread"
                  style={{ width: "24px", height: "24px" }}
                  onClick={() => onDelete(thread.id)}
                >
                  <X size={12} />
                </button>
              </span>
            </div>
          ))}
          {filtered.length === 0 ? (
            <p style={{ padding: "10px 12px", color: "var(--muted)", fontSize: "13px", margin: 0 }}>
              No threads
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
