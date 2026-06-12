import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { WorkbenchAgentClient, WorkbenchState } from "@pe/workbench-core";
import { createWorkbenchController, type WorkbenchController } from "@pe/workbench-core";
import { renderWorkbenchApp } from "./app.jsx";
import { peaTheme } from "./theme.js";

export interface WorkbenchTuiOptions {
  client: WorkbenchAgentClient;
  cwd: string;
  additionalDirectories?: string[];
  title?: string;
  fallbackToLineMode?: boolean;
}

export async function runWorkbenchTui(options: WorkbenchTuiOptions): Promise<void> {
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
  controller.subscribe((state, event) => {
    if (event.type === "message_delta" && event.role === "assistant") output.write(event.delta);
    if (event.type === "tool_call_updated")
      output.write(`\n[tool:${event.toolCall.status ?? "running"}] ${event.toolCall.title}\n`);
    if (event.type === "approval_requested") output.write(renderApprovalHint(state));
  });

  await controller.start();
  output.write(`${renderHeader(options.title, controller.getState())}\n`);

  while (true) {
    const state = controller.getState();
    const approval = state.approvals[0];
    if (approval) {
      const answer = await reader.question("Approve? [y] once, [a] always, [n] no > ");
      resolveApprovalText(controller, answer);
      continue;
    }

    const text = await reader.question("> ");
    if (text.trim() === "/exit") break;
    await controller.send(text);
    output.write("\n");
  }

  reader.close();
  await controller.close();
}

function resolveApprovalKey(controller: WorkbenchController, keyName: string): void {
  const approval = controller.getState().approvals[0];
  if (!approval) return;

  if (keyName === "y") {
    controller.resolveApproval(approval.requestId, optionId(approval.options, "allow_once"));
    return;
  }

  if (keyName === "a") {
    controller.resolveApproval(
      approval.requestId,
      optionId(approval.options, "allow_always") ?? optionId(approval.options, "allow_once"),
    );
    return;
  }

  if (keyName === "n")
    controller.resolveApproval(approval.requestId, optionId(approval.options, "reject_once"));
}

function resolveApprovalText(controller: WorkbenchController, answer: string): void {
  const key = answer.trim().toLowerCase().slice(0, 1);
  resolveApprovalKey(controller, key || "n");
}

function optionId(
  options: WorkbenchState["approvals"][number]["options"],
  kind: WorkbenchState["approvals"][number]["options"][number]["kind"],
): string | undefined {
  return options.find((option) => option.kind === kind)?.optionId;
}

function renderHeader(title: string | undefined, state: WorkbenchState): string {
  const agentTitle = state.agent?.title ?? state.agent?.name ?? "agent";
  const session = state.session ? `session ${state.session.sessionId}` : "no session";
  const capabilities = capabilityLabels(state).join(", ");
  return `${title ?? "Pe.Tools"} | ${agentTitle} | ${state.status} | ${session}${capabilities ? ` | ${capabilities}` : ""}`;
}

function renderApprovalHint(state: WorkbenchState): string {
  const approval = state.approvals[0];
  if (!approval) return "";

  const options = approval.options.map((option) => `${option.kind}:${option.name}`).join(", ");
  return `[approval] ${approval.toolCall.title}\n${options}\nPress y=allow once, a=allow always, n=deny.`;
}

function capabilityLabels(state: WorkbenchState): string[] {
  const capabilities = state.agent?.capabilities;
  if (!capabilities) return [];

  return Object.entries(capabilities)
    .filter((entry) => entry[1])
    .map((entry) => entry[0]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
