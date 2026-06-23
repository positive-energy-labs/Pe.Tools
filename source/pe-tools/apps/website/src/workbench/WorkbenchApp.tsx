import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { selectWorkbenchChrome, type WorkbenchState } from "@pe/agent-contracts";
import { ArrowUp, Plus, Search, Square, X } from "lucide-react";
import { WorkbenchProvider, useWorkbench, type StoredThreadSummary } from "./WorkbenchProvider.tsx";
import { Lens } from "./Lens.tsx";
import { MODE_HINT, MODES, useMode, type Mode } from "./depth.ts";

export function WorkbenchApp() {
  return (
    <WorkbenchProvider>
      <Surface />
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
          <ModelChips state={debug.state} />
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
        {debug.loading || debug.error || operation || operationError ? (
          <div className={`mg-status ${debug.error || operationError ? "error" : "loading"}`}>
            <span>{debug.error ?? operationError ?? operation ?? "Loading thread state"}</span>
          </div>
        ) : null}
      </div>

      <Lens state={debug.state} mode={mode} />

      <div className="mg-composer-wrap">
        <Composer />
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

function ModelChips({ state }: { state: WorkbenchState }) {
  const model = state.models.currentModelId
    ? (state.models.availableModels.find((item) => item.id === state.models.currentModelId)
        ?.displayName ?? state.models.currentModelId)
    : undefined;
  const access = state.access.currentAccessLevel;
  return (
    <>
      {model ? <span className="mg-chip">{model}</span> : null}
      {access ? <span className="mg-chip">{access}</span> : null}
    </>
  );
}

function Composer() {
  const { sendPrompt, cancel, isRunning, operationError } = useWorkbench();
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0 && !isRunning;

  const sendCurrent = () => {
    if (!canSend) return;
    const prompt = text;
    setText("");
    void sendPrompt(prompt);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    sendCurrent();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrent();
    }
  };

  return (
    <form className={`mg-composer ${isRunning ? "running" : ""}`} onSubmit={submit}>
      <textarea
        name="input"
        placeholder="Ask Pea…"
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
      {operationError ? <span style={{ fontSize: "11px" }}>{operationError}</span> : null}
    </form>
  );
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
