import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { render, type JSX } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { CliRenderer, KeyEvent } from "@opentui/core";
import type { WorkbenchApprovalOption } from "@pe/agent-contracts";
import { selectActiveThreadId, selectVisibleThreads } from "@pe/agent-projection";
import type { WorkbenchApprovalRequest, WorkbenchController } from "@pe/workbench-core";
import { ApprovalModal } from "./components/approval-modal.jsx";
import { Header } from "./components/header.jsx";
import { Prompt, type PromptHandle } from "./components/prompt.jsx";
import { ThreadHistoryPane } from "./components/thread-history-pane.jsx";
import { ToolPane } from "./components/tool-pane.jsx";
import { Transcript } from "./components/transcript.jsx";
import { peaTheme } from "./theme.js";

export interface WorkbenchAppOptions {
  controller: WorkbenchController;
  renderer: CliRenderer;
  title?: string;
}

interface WorkbenchActions {
  submit(text: string): Promise<void>;
  exit(): void;
  resolveApproval(requestId: string, optionId?: string): void;
}

type PeaKeymap = ReturnType<typeof createDefaultOpenTuiKeymap>;

export async function renderWorkbenchApp(options: WorkbenchAppOptions): Promise<void> {
  const keymap = createDefaultOpenTuiKeymap(options.renderer);
  const shutdown = new Promise<void>((resolve) => options.renderer.once("destroy", resolve));
  let exiting = false;

  const exit = () => {
    if (exiting) return;
    exiting = true;
    void options.controller.close().finally(() => {
      if (!options.renderer.isDestroyed) options.renderer.destroy();
    });
  };
  const onGlobalKeypress = (event: KeyEvent) => {
    if (!(event.name === "d" && event.ctrl)) return;
    event.preventDefault();
    event.stopPropagation();
    exit();
  };
  options.renderer.keyInput.on("keypress", onGlobalKeypress);
  options.renderer.once("destroy", () => {
    options.renderer.keyInput.off("keypress", onGlobalKeypress);
  });

  await render(
    () => (
      <WorkbenchApp
        title={options.title}
        controller={options.controller}
        keymap={keymap}
        actions={{
          async submit(text) {
            await options.controller.send(text);
          },
          exit,
          resolveApproval(requestId, optionId) {
            options.controller.resolveApproval(requestId, optionId);
          },
        }}
      />
    ),
    options.renderer,
  );

  await shutdown;
}

function WorkbenchApp(props: {
  title?: string;
  controller: WorkbenchController;
  keymap: PeaKeymap;
  actions: WorkbenchActions;
}): JSX.Element {
  const [state, setState] = createSignal(props.controller.getState());
  const [prompt, setPrompt] = createSignal<PromptHandle>();
  const [sending, setSending] = createSignal(false);
  const [localErrors, setLocalErrors] = createSignal<string[]>([]);
  const [approvalExpanded, setApprovalExpanded] = createSignal(false);
  const [selectedApprovalOptionId, setSelectedApprovalOptionId] = createSignal<string>();
  const [selectedThreadId, setSelectedThreadId] = createSignal<string>();
  const [threadLoading, setThreadLoading] = createSignal(false);
  const [threadError, setThreadError] = createSignal<string>();
  const [overlay, setOverlay] = createSignal<"commands" | "help" | undefined>();
  const approval = createMemo(() =>
    state().approvals.requests.find((request) => request.status === "pending"),
  );
  const unsubscribe = props.controller.subscribe((next) => setState(() => next));
  onCleanup(unsubscribe);

  onMount(() => {
    void props.controller.start().catch((error: unknown) => {
      setLocalErrors((errors) => [...errors.slice(-2), `Start failed: ${errorMessage(error)}`]);
    });
  });

  createEffect(() => {
    const current = approval();
    if (!current) {
      setApprovalExpanded(false);
      setSelectedApprovalOptionId(undefined);
      return;
    }
    const existing = current.options.some(
      (option) => option.optionId === selectedApprovalOptionId(),
    );
    if (!existing) setSelectedApprovalOptionId(current.options[0]?.optionId);
  });

  const submit = async (text: string): Promise<boolean> => {
    setSending(true);
    try {
      await props.actions.submit(text);
      setLocalErrors([]);
      return true;
    } catch (error: unknown) {
      setLocalErrors((errors) => [...errors.slice(-2), errorMessage(error)]);
      return false;
    } finally {
      setSending(false);
      prompt()?.focus();
    }
  };

  createEffect(() => {
    const threads = selectVisibleThreads(state());
    const current = selectedThreadId();
    if (current && threads.some((thread) => thread.threadId === current)) return;
    setSelectedThreadId(selectActiveThreadId(state()) ?? threads[0]?.threadId);
  });

  const refreshThreads = async () => {
    setThreadLoading(true);
    try {
      await props.controller.refreshThreads();
      setThreadError(undefined);
    } catch (error: unknown) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadLoading(false);
    }
  };

  const loadSelectedThread = async () => {
    const threadId = selectedThreadId();
    if (!threadId) return;
    setThreadLoading(true);
    try {
      await props.controller.loadThread(threadId);
      setLocalErrors([]);
      setThreadError(undefined);
      prompt()?.focus();
    } catch (error: unknown) {
      setThreadError(errorMessage(error));
    } finally {
      setThreadLoading(false);
    }
  };

  const moveThreadSelection = (direction: number) => {
    const threads = selectVisibleThreads(state());
    if (threads.length === 0) return;
    const index = threads.findIndex((thread) => thread.threadId === selectedThreadId());
    const current = index < 0 ? 0 : index;
    const next = threads[(current + direction + threads.length) % threads.length];
    setSelectedThreadId(next?.threadId);
  };

  const resolveSelectedApproval = () => {
    const current = approval();
    if (!current) return;
    props.actions.resolveApproval(current.requestId, selectedApprovalOptionId());
  };

  usePeaKeymap(props.keymap, {
    prompt,
    approval,
    selectedApprovalOptionId,
    setSelectedApprovalOptionId,
    toggleApprovalExpanded() {
      if (approval()) setApprovalExpanded((value) => !value);
    },
    resolveSelectedApproval,
    refreshThreads: () => void refreshThreads(),
    loadSelectedThread: () => void loadSelectedThread(),
    selectNextThread: () => moveThreadSelection(1),
    selectPreviousThread: () => moveThreadSelection(-1),
    showCommandPalette: () => setOverlay("commands"),
    showHelp: () => setOverlay("help"),
    closeOverlay: () => setOverlay(undefined),
    exit: () => props.actions.exit(),
  });

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={peaTheme.background}>
      <Header title={props.title} state={state} />
      <box flexGrow={1} minHeight={0} flexDirection="row">
        <ThreadHistoryPane
          state={state}
          selectedThreadId={selectedThreadId()}
          loading={threadLoading()}
          error={threadError()}
          onRefresh={() => void refreshThreads()}
          onSelect={setSelectedThreadId}
        />
        <box flexGrow={1} minWidth={0} flexDirection="column" backgroundColor={peaTheme.background}>
          <Transcript state={state} localErrors={localErrors} />
          <Prompt
            disabled={sending()}
            onSubmit={submit}
            onExit={() => props.actions.exit()}
            onReady={setPrompt}
          />
        </box>
        <ToolPane state={state} />
      </box>
      <ApprovalModal
        approval={approval()}
        selectedOptionId={selectedApprovalOptionId()}
        expanded={approvalExpanded()}
        onSelect={setSelectedApprovalOptionId}
        onToggleExpanded={() => setApprovalExpanded((value) => !value)}
      />
      {overlay() ? (
        <CommandOverlay kind={overlay()!} onClose={() => setOverlay(undefined)} />
      ) : null}
    </box>
  );
}

function CommandOverlay(props: { kind: "commands" | "help"; onClose: () => void }): JSX.Element {
  const rows =
    props.kind === "commands"
      ? [
          ["ctrl+k", "Open command palette"],
          ["ctrl+r", "Refresh thread timeline"],
          ["ctrl+↑/↓", "Move thread selection"],
          ["ctrl+enter", "Load selected thread"],
          ["y / a / n", "Resolve approvals"],
          ["/exit", "Quit Pea"],
        ]
      : [
          ["home", "Centered prompt, rotating suggestions, and feature exposure"],
          ["left", "Thread timeline and quick reload"],
          ["center", "Transcript, plan, tool trace, and prompt"],
          ["right", "Inspector with tools, debug events, and memory"],
          ["approvals", "Permission dock keeps raw details visible"],
          ["runtime", "All panes read shared workbench projection state"],
        ];

  return (
    <box
      position="absolute"
      zIndex={3000}
      left={0}
      top={0}
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      backgroundColor="#000000cc"
      onMouseDown={props.onClose}
    >
      <box
        width={72}
        flexDirection="column"
        backgroundColor={peaTheme.backgroundPanel}
        border
        borderColor={peaTheme.borderActive}
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        gap={1}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={peaTheme.primary}>
            {props.kind === "commands" ? "command palette" : "workbench help"}
          </text>
          <text fg={peaTheme.textMuted}>esc close</text>
        </box>
        {rows.map((row) => (
          <box flexDirection="row" gap={2}>
            <text fg={peaTheme.accent}>{row[0]}</text>
            <text fg={peaTheme.text}>{row[1]}</text>
          </box>
        ))}
      </box>
    </box>
  );
}

function usePeaKeymap(
  keymap: PeaKeymap,
  props: {
    prompt: () => PromptHandle | undefined;
    approval: () => WorkbenchApprovalRequest | undefined;
    selectedApprovalOptionId: () => string | undefined;
    setSelectedApprovalOptionId: (optionId: string | undefined) => void;
    toggleApprovalExpanded: () => void;
    resolveSelectedApproval: () => void;
    refreshThreads: () => void;
    loadSelectedThread: () => void;
    selectNextThread: () => void;
    selectPreviousThread: () => void;
    showCommandPalette: () => void;
    showHelp: () => void;
    closeOverlay: () => void;
    exit: () => void;
  },
): void {
  const selectApprovalByKind = (kind: WorkbenchApprovalOption["kind"]) => {
    const current = props.approval();
    if (!current) return;
    const option = current.options.find((item) => item.kind === kind);
    if (!option) return;
    props.setSelectedApprovalOptionId(option.optionId);
    props.resolveSelectedApproval();
  };

  const moveApprovalSelection = (direction: number) => {
    const current = props.approval();
    if (!current) return;
    const options = current.options;
    if (options.length === 0) return;
    const selected = options.findIndex(
      (option) => option.optionId === props.selectedApprovalOptionId(),
    );
    const index = selected < 0 ? 0 : selected;
    const next = options[(index + direction + options.length) % options.length];
    props.setSelectedApprovalOptionId(next?.optionId);
  };

  createEffect(() => {
    const hasApproval = Boolean(props.approval());
    const unregister = keymap.registerLayer({
      commands: [
        { name: "app.exit", title: "Exit Pea", category: "App", run: props.exit },
        {
          name: "command.palette.show",
          title: "Command palette",
          category: "App",
          run: props.showCommandPalette,
        },
        { name: "help.show", title: "Show help", category: "App", run: props.showHelp },
        { name: "overlay.close", title: "Close overlay", category: "App", run: props.closeOverlay },
        {
          name: "prompt.submit",
          title: "Submit prompt",
          category: "Prompt",
          run: () => props.prompt()?.submit(),
        },
        {
          name: "approval.select_next",
          title: "Next approval option",
          category: "Approval",
          run: () => moveApprovalSelection(1),
        },
        {
          name: "approval.select_previous",
          title: "Previous approval option",
          category: "Approval",
          run: () => moveApprovalSelection(-1),
        },
        {
          name: "approval.confirm",
          title: "Confirm approval option",
          category: "Approval",
          run: props.resolveSelectedApproval,
        },
        {
          name: "approval.toggle_detail",
          title: "Toggle approval detail",
          category: "Approval",
          run: props.toggleApprovalExpanded,
        },
        {
          name: "approval.allow_once",
          title: "Allow once",
          category: "Approval",
          run: () => selectApprovalByKind("allow_once"),
        },
        {
          name: "approval.allow_always",
          title: "Allow always",
          category: "Approval",
          run: () => selectApprovalByKind("allow_always"),
        },
        {
          name: "approval.reject",
          title: "Reject",
          category: "Approval",
          run: () => selectApprovalByKind("reject_once"),
        },
        {
          name: "threads.refresh",
          title: "Refresh threads",
          category: "Threads",
          run: props.refreshThreads,
        },
        {
          name: "threads.load_selected",
          title: "Load selected thread",
          category: "Threads",
          run: props.loadSelectedThread,
        },
        {
          name: "threads.select_next",
          title: "Next thread",
          category: "Threads",
          run: props.selectNextThread,
        },
        {
          name: "threads.select_previous",
          title: "Previous thread",
          category: "Threads",
          run: props.selectPreviousThread,
        },
      ],
      bindings: [
        { key: "escape", cmd: "overlay.close" },
        { key: "ctrl+d", cmd: "app.exit" },
        { key: "ctrl+k", cmd: "command.palette.show" },
        { key: "?", cmd: "help.show" },
        { key: "ctrl+r", cmd: "threads.refresh" },
        { key: "ctrl+down", cmd: "threads.select_next" },
        { key: "ctrl+up", cmd: "threads.select_previous" },
        { key: "ctrl+enter", cmd: "threads.load_selected" },
        ...(hasApproval
          ? [
              { key: "right", cmd: "approval.select_next" },
              { key: "left", cmd: "approval.select_previous" },
              { key: "return", cmd: "approval.confirm" },
              { key: "d", cmd: "approval.toggle_detail" },
              { key: "y", cmd: "approval.allow_once" },
              { key: "a", cmd: "approval.allow_always" },
              { key: "n", cmd: "approval.reject" },
            ]
          : []),
      ],
    });
    onCleanup(unregister);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
