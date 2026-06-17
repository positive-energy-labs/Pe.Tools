import { createInterface } from "node:readline/promises";
import { env, stdin as input, stdout as output } from "node:process";
import {
  selectActiveThreadId,
  selectPendingApprovals,
  selectVisibleThreads,
  selectWorkbenchChrome,
} from "@pe/agent-projection";
import type {
  WorkbenchAgentClient,
  WorkbenchApprovalRequest,
  WorkbenchState,
} from "@pe/workbench-core";
import { createWorkbenchController, type WorkbenchController } from "@pe/workbench-core";
import { renderWorkbenchApp } from "./app.jsx";
import { peaTheme } from "./theme.js";

export interface WorkbenchTuiOptions {
  client: WorkbenchAgentClient;
  cwd: string;
  additionalDirectories?: string[];
  title?: string;
  lineMode?: boolean;
  fallbackToLineMode?: boolean;
}

export async function runWorkbenchTui(options: WorkbenchTuiOptions): Promise<void> {
  if (options.lineMode || env.PE_TUI_LINE_MODE === "1") {
    await runLineWorkbench(options);
    return;
  }

  try {
    await runOpenTui(options);
  } catch (error) {
    if (options.fallbackToLineMode === false) throw error;

    output.write(`OpenTUI renderer unavailable; using line mode. ${errorMessage(error)}\n`);
    await runLineWorkbench(options);
  }
}

async function runOpenTui(options: WorkbenchTuiOptions): Promise<void> {
  const controller = createWorkbenchController(options.client, {
    cwd: options.cwd,
    additionalDirectories: options.additionalDirectories,
  });
  await controller.start();

  const opentui = await import("@opentui/core");
  const renderer = await opentui.createCliRenderer({
    exitOnCtrlC: false,
    backgroundColor: peaTheme.background,
  });

  await renderWorkbenchApp({ controller, renderer, title: options.title });
}

async function runLineWorkbench(options: WorkbenchTuiOptions): Promise<void> {
  const controller = createWorkbenchController(options.client, {
    cwd: options.cwd,
    additionalDirectories: options.additionalDirectories,
  });
  const reader = createInterface({ input, output });
  let pendingSends = 0;
  let lastDoneKey: string | undefined;

  const unsubscribe = controller.subscribe((state, event) => {
    if (event.type === "message_part_delta" && event.role === "assistant") {
      if (state.uiStatus.send.status === "running") output.write(partText(event.part));
    }
    if (event.type === "tool_call_updated" && state.uiStatus.send.status === "running")
      output.write(`\n[tool:${event.toolCall.status ?? "running"}] ${event.toolCall.title}\n`);
    if (event.type === "approval_requested") output.write(`\n${renderApprovalHint(state)}\n`);
    if (event.type === "run_status_changed" && event.status === "idle") {
      const doneKey = `${state.agent.session?.sessionId ?? ""}:${state.transcript.messages.length}:${event.stopReason ?? ""}`;
      if (doneKey !== lastDoneKey) {
        lastDoneKey = doneKey;
        output.write(`\n[done${event.stopReason ? `: ${event.stopReason}` : ""}]\n`);
      }
    }
    if (event.type === "error") output.write(`\n[error] ${event.message}\n`);
  });

  try {
    await controller.start();
    output.write(`${renderHeader(options.title, controller.getState())}\n`);
    output.write(`${renderLineHelp()}\n`);
    output.write(`${renderThreads(controller.getState())}\n`);

    while (true) {
      const approval = selectPendingApprovals(controller.getState())[0];
      if (approval) {
        const answer = await reader.question("approval y/a/n > ");
        resolveApprovalText(controller, answer);
        continue;
      }

      const text = await reader.question(promptText(controller.getState(), pendingSends));
      const trimmed = text.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith("/")) {
        const keepRunning = await handleLineCommand(controller, options.title, trimmed);
        if (!keepRunning) break;
        continue;
      }

      if (pendingSends > 0 || controller.getState().uiStatus.overall.status === "running") {
        output.write(
          "[busy] Pea is still running. Use /cancel, wait, or answer an approval prompt.\n",
        );
        continue;
      }

      pendingSends += 1;
      void controller
        .send(text)
        .catch((error: unknown) => output.write(`\n[error] ${errorMessage(error)}\n`))
        .finally(() => {
          pendingSends -= 1;
        });
    }
  } finally {
    if (pendingSends > 0) await controller.cancel().catch(() => undefined);
    unsubscribe();
    reader.close();
    await controller.close();
  }
}

async function handleLineCommand(
  controller: WorkbenchController,
  title: string | undefined,
  inputText: string,
): Promise<boolean> {
  const [command = "", ...args] = inputText.slice(1).split(/\s+/);
  const argument = args.join(" ").trim();

  switch (command.toLowerCase()) {
    case "exit":
    case "quit":
    case "q":
      return false;
    case "help":
    case "h":
    case "?":
      output.write(`${renderLineHelp()}\n`);
      return true;
    case "threads":
    case "t":
      output.write(`${renderThreads(controller.getState())}\n`);
      return true;
    case "refresh":
    case "r":
      await controller.refreshThreads();
      output.write(`${renderThreads(controller.getState())}\n`);
      return true;
    case "load": {
      const thread = resolveThread(controller.getState(), argument);
      if (!thread) {
        output.write("Usage: /load <thread number | thread id prefix>\n");
        output.write(`${renderThreads(controller.getState())}\n`);
        return true;
      }

      output.write(`[load] ${thread.title ?? thread.threadId}\n`);
      await controller.loadThread(thread.threadId);
      output.write(`${renderHeader(title, controller.getState())}\n`);
      output.write(`${renderTranscript(controller.getState())}\n`);
      return true;
    }
    case "new":
      await controller.newSession();
      output.write(`${renderHeader(title, controller.getState())}\n`);
      output.write(`${renderThreads(controller.getState())}\n`);
      return true;
    case "cancel":
      await controller.cancel();
      output.write("[cancel requested]\n");
      return true;
    default:
      output.write(`Unknown command: /${command}\n${renderLineHelp()}\n`);
      return true;
  }
}

function resolveApprovalKey(controller: WorkbenchController, keyName: string): void {
  const approval = selectPendingApprovals(controller.getState())[0];
  if (!approval) return;

  if (keyName === "y") {
    controller.resolveApproval(approval.requestId, optionId(approval, "allow_once"));
    return;
  }

  if (keyName === "a") {
    controller.resolveApproval(
      approval.requestId,
      optionId(approval, "allow_always") ?? optionId(approval, "allow_once"),
    );
    return;
  }

  if (keyName === "n")
    controller.resolveApproval(approval.requestId, optionId(approval, "reject_once"));
}

function resolveApprovalText(controller: WorkbenchController, answer: string): void {
  resolveApprovalKey(controller, answer.trim().toLowerCase().slice(0, 1) || "n");
}

function optionId(
  approval: WorkbenchApprovalRequest,
  kind: WorkbenchApprovalRequest["options"][number]["kind"],
): string | undefined {
  return approval.options.find((option) => option.kind === kind)?.optionId;
}

function renderHeader(title: string | undefined, state: WorkbenchState): string {
  const chrome = selectWorkbenchChrome(state);
  return `${title ?? chrome.title} | ${chrome.status} | ${chrome.threadLabel} | ${chrome.modelLabel} | ${chrome.modeLabel}`;
}

function renderLineHelp(): string {
  return "Type a message and press Enter. Commands: /threads, /refresh, /load <n|id>, /new, /cancel, /exit.";
}

function renderApprovalHint(state: WorkbenchState): string {
  const approval = selectPendingApprovals(state)[0];
  if (!approval) return "";

  const options = approval.options.map((option) => `${option.kind}:${option.name}`).join(", ");
  return `[approval] ${approval.toolCall.title}\n${options}\nAnswer y=allow once, a=allow always, n=deny.`;
}

function promptText(state: WorkbenchState, pendingSends: number): string {
  if (pendingSends > 0 || state.uiStatus.overall.status === "running") return "running> ";
  return "Pea> ";
}

function renderThreads(state: WorkbenchState): string {
  const threads = selectVisibleThreads(state);
  if (threads.length === 0) return "threads: none";

  const activeThreadId = selectActiveThreadId(state);
  const rows = threads.map((thread, index) => {
    const active =
      thread.threadId === activeThreadId || thread.sessionId === activeThreadId ? "*" : " ";
    const title = thread.title ?? "(untitled)";
    const updated = thread.updatedAt ? ` · ${thread.updatedAt}` : "";
    return `${active} ${index + 1}. ${shortId(thread.threadId)} · ${title}${updated}`;
  });
  return `threads:\n${rows.join("\n")}`;
}

function renderTranscript(state: WorkbenchState): string {
  if (state.transcript.messages.length === 0) return "transcript: empty\n";

  const rows = state.transcript.messages
    .slice(-20)
    .map((message) => {
      const text = message.parts.map(partText).join("").trim();
      if (!text) return undefined;
      return `${message.role}> ${text}`;
    })
    .filter((row) => row !== undefined);

  return rows.length === 0 ? "transcript: empty\n" : `transcript:\n${rows.join("\n")}\n`;
}

function resolveThread(
  state: WorkbenchState,
  selector: string,
): WorkbenchState["threads"]["items"][number] | undefined {
  if (!selector) return undefined;

  const threads = selectVisibleThreads(state);
  const index = Number(selector);
  if (Number.isInteger(index) && index >= 1) return threads[index - 1];

  const normalized = selector.toLowerCase();
  return (
    threads.find(
      (thread) =>
        thread.threadId.toLowerCase() === normalized ||
        thread.sessionId?.toLowerCase() === normalized,
    ) ??
    threads.find(
      (thread) =>
        thread.threadId.toLowerCase().startsWith(normalized) ||
        thread.sessionId?.toLowerCase().startsWith(normalized),
    )
  );
}

function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 8)}…`;
}

function partText(part: WorkbenchState["transcript"]["messages"][number]["parts"][number]): string {
  if (part.kind === "text" || part.kind === "reasoning" || part.kind === "thought")
    return part.text;
  if (part.kind === "status") return part.text;
  if (part.kind === "error") return part.message;
  return "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
