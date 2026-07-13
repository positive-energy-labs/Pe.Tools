import { useState } from "react";
import {
  type ScheduleGridDocument,
  readRouteState,
  scheduleGridRouteState,
  splitScheduleCellKey,
} from "@pe/agent-contracts";
import { Check, RotateCcw, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "#/components/ui/button";
import { peUrl } from "../config";
import { useWorkbench } from "../provider";
import { writeRouteState } from "../route-state";
import {
  InlineRoutePlugin,
  Metric,
  type RouteChatPluginProps,
  actionLabel,
} from "../route-chat-plugins";

/**
 * Inline chat card + reviewer for the /schedule-grid route. Mirrors FamilyTypesChatPlugin:
 * the compact card shows counts; when active (the authoritative end-of-chat dock) it lists
 * every proposal/staged cell with row + column labels and lets the human approve → stage,
 * deny, undo, and push — each a human-actor write through the route-state dispatcher.
 */
export function ScheduleGridChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  active,
  onRouteDocumentChange,
}: RouteChatPluginProps) {
  const document = readRouteState(sessionState, scheduleGridRouteState);
  const model = summarizeScheduleGrid(document);
  const { config } = useWorkbench();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (active && model.items.length === 0) return null;

  const write = async (key: string, suffix: "apply" | "command", body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const result = await writeRouteState(config, "schedule-grid", suffix, body);
      setError(writeError(result));
      if (result.ok && onRouteDocumentChange) {
        const response = await fetch(peUrl(config, "/route-state/schedule-grid"));
        const snapshot = (await response.json()) as { doc?: unknown };
        if (snapshot.doc != null) onRouteDocumentChange(snapshot.doc);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Route update failed.");
    } finally {
      setBusy(null);
    }
  };

  const columnLabel = (columnNumber: number) =>
    document?.snapshot?.columns.find((column) => column.columnNumber === columnNumber)
      ?.headerText ?? `col ${columnNumber}`;

  const interactive = active && model.items.length > 0;
  return (
    <InlineRoutePlugin title="Schedule Grid" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={model.proposalCount} label="open proposals" />
        <Metric value={model.stagedCount} label="staged" />
        <Metric value={model.attentionCount} label="need attention" issue />
        <Link
          className="ml-auto font-medium text-[var(--pe-blue)] hover:underline"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "schedule-grid" })}
        >
          Open workspace
        </Link>
      </div>

      {interactive ? (
        <div className="mt-1.5 w-full border-t border-[var(--line-2)]">
          <div className="max-h-64 overflow-y-auto">
            {model.items.map(([key, cell]) => {
              const { rowNumber, columnNumber } = splitScheduleCellKey(key);
              const staged = cell.staged != null;
              return (
                <div
                  key={key}
                  className="flex min-h-12 items-center gap-2 border-b border-[var(--line-2)] py-1.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--clay-ink)]">
                      {columnLabel(columnNumber)}{" "}
                      <span className="font-normal text-[var(--lichen)]">· row {rowNumber}</span>
                    </div>
                    <div className="truncate text-[var(--slate)]">
                      {staged ? cell.staged : cell.proposal?.value}
                    </div>
                    {!staged && (cell.proposal?.confidence || cell.proposal?.note) ? (
                      <div className="truncate text-[10px] text-[var(--lichen)]">
                        {[cell.proposal.confidence, cell.proposal.note].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                  {staged ? (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      title="Undo approval"
                      disabled={busy != null}
                      onClick={() =>
                        void write(key, "apply", {
                          patches: [
                            { path: ["cells", key, "staged"] },
                            { path: ["cells", key, "review"], value: "none" },
                          ],
                        })
                      }
                    >
                      <RotateCcw />
                    </Button>
                  ) : (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Deny suggestion"
                        disabled={busy != null}
                        onClick={() =>
                          void write(key, "apply", {
                            patches: [
                              { path: ["cells", key, "proposal"] },
                              { path: ["cells", key, "review"], value: "none" },
                            ],
                          })
                        }
                      >
                        <X />
                      </Button>
                      <Button
                        size="icon-sm"
                        title="Approve and stage suggestion"
                        disabled={busy != null || !cell.proposal}
                        onClick={() =>
                          void write(key, "apply", {
                            patches: [
                              { path: ["cells", key, "staged"], value: cell.proposal?.value },
                              { path: ["cells", key, "review"], value: "good" },
                            ],
                          })
                        }
                      >
                        <Check />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1.5">
            <span className="min-w-0 truncate text-[10px] text-[var(--lichen)]">
              {error ??
                (model.attentionCount > 0
                  ? `${model.attentionCount} value${model.attentionCount === 1 ? " needs" : "s need"} review`
                  : "Pea can propose; only you can push.")}
            </span>
            <Button
              size="sm"
              disabled={!model.canPush || busy != null}
              onClick={() => void write("push", "command", { command: "push", input: {} })}
            >
              <Check />
              Push {model.stagedCount} to Revit
            </Button>
          </div>
        </div>
      ) : null}
    </InlineRoutePlugin>
  );
}

function summarizeScheduleGrid(document: ScheduleGridDocument | null) {
  const entries = Object.entries(document?.cells ?? {});
  const items = entries.filter(([, cell]) => cell.proposal != null || cell.staged != null);
  const staged = entries.filter(([, cell]) => cell.staged != null);
  return {
    items,
    proposalCount: entries.filter(([, cell]) => cell.proposal != null && cell.staged == null)
      .length,
    stagedCount: staged.length,
    attentionCount: items.filter(([, cell]) => cell.review === "attention").length,
    canPush: staged.length > 0 && staged.every(([, cell]) => cell.review !== "attention"),
  };
}

function writeError(result: {
  ok: boolean;
  error?: string;
  hint?: string;
  result?: unknown;
}): string | null {
  if (!result.ok) return result.error ?? result.hint ?? "Route update failed.";
  const payload = result.result;
  if (typeof payload !== "object" || payload == null) return null;
  const failures = (payload as { failures?: unknown }).failures;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const first = failures[0] as { key?: string; error?: string };
  const detail = [first?.key, first?.error].filter((part) => typeof part === "string").join(": ");
  return `${failures.length} value${failures.length === 1 ? "" : "s"} failed${detail ? `: ${detail}` : "."}`;
}
