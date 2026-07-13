import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import { Link } from "@tanstack/react-router";

import {
  type SettingsFieldState,
  type SettingsRouteDocument,
  readRouteState,
  settingsRouteState,
} from "@pe/agent-contracts";

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

/** Inline chat card + reviewer for the /settings route (mirrors FamilyTypesChatPlugin). */
export function SettingsChatPlugin({
  toolName,
  args,
  sessionState,
  running,
  active,
  onRouteDocumentChange,
}: RouteChatPluginProps) {
  const document = readRouteState(sessionState, settingsRouteState);
  const model = summarizeSettings(document);
  const { config } = useWorkbench();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (active && model.items.length === 0) return null;

  const write = async (key: string, suffix: "apply" | "command", body: Record<string, unknown>) => {
    setBusy(key);
    setError(null);
    try {
      const result = await writeRouteState(config, "settings", suffix, body);
      if (!result.ok) setError(result.error ?? result.hint ?? "Route update failed.");
      else if (onRouteDocumentChange) {
        const response = await fetch(peUrl(config, "/route-state/settings"));
        const snapshot = (await response.json()) as { doc?: unknown };
        if (snapshot.doc != null) onRouteDocumentChange(snapshot.doc);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Route update failed.");
    } finally {
      setBusy(null);
    }
  };

  const interactive = active && model.items.length > 0;
  return (
    <InlineRoutePlugin title="Settings" action={actionLabel(toolName, args, running)}>
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1">
        <Metric value={model.proposalCount} label="open proposals" />
        <Metric value={model.stagedCount} label="staged" />
        <Metric value={model.attentionCount} label="need attention" issue />
        <Link
          className="ml-auto font-medium text-[var(--pe-blue)] hover:underline"
          to="/chat"
          search={(previous) => ({ ...previous, plugin: "settings" })}
        >
          Open workspace
        </Link>
      </div>

      {interactive ? (
        <div className="mt-1.5 w-full border-t border-[var(--line-2)]">
          <div className="max-h-64 overflow-y-auto">
            {model.items.map(([path, field]) => {
              const staged = field.hasStaged;
              return (
                <div
                  key={path}
                  className="flex min-h-12 items-center gap-2 border-b border-[var(--line-2)] py-1.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono font-medium text-[var(--clay-ink)]">
                      {path}
                    </div>
                    <div className="truncate text-[var(--slate)]">
                      {display(staged ? field.staged : field.proposal?.value)}
                    </div>
                    {!staged && (field.proposal?.confidence || field.proposal?.note) ? (
                      <div className="truncate text-[10px] text-[var(--lichen)]">
                        {[field.proposal.confidence, field.proposal.note]
                          .filter(Boolean)
                          .join(" · ")}
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
                        void write(path, "apply", {
                          patches: [
                            { path: ["fields", path, "staged"] },
                            { path: ["fields", path, "hasStaged"], value: false },
                            { path: ["fields", path, "review"], value: "none" },
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
                          void write(path, "apply", {
                            patches: [
                              { path: ["fields", path, "proposal"] },
                              { path: ["fields", path, "review"], value: "none" },
                            ],
                          })
                        }
                      >
                        <X />
                      </Button>
                      <Button
                        size="icon-sm"
                        title="Approve and stage suggestion"
                        disabled={busy != null || !field.proposal}
                        onClick={() =>
                          void write(path, "apply", {
                            patches: [
                              { path: ["fields", path, "staged"], value: field.proposal?.value },
                              { path: ["fields", path, "hasStaged"], value: true },
                              { path: ["fields", path, "review"], value: "good" },
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
                  : "Pea can propose; only you can save.")}
            </span>
            <Button
              size="sm"
              disabled={!model.canSave || busy != null}
              onClick={() => void write("save", "command", { command: "save", input: {} })}
            >
              <Check />
              Save {model.stagedCount}
            </Button>
          </div>
        </div>
      ) : null}
    </InlineRoutePlugin>
  );
}

function summarizeSettings(document: SettingsRouteDocument | null) {
  const entries = Object.entries(document?.fields ?? {});
  const items: [string, SettingsFieldState][] = entries.filter(
    ([, field]) => field.proposal != null || field.hasStaged,
  );
  const staged = entries.filter(([, field]) => field.hasStaged);
  return {
    items,
    proposalCount: entries.filter(([, field]) => field.proposal != null && !field.hasStaged).length,
    stagedCount: staged.length,
    attentionCount: items.filter(([, field]) => field.review === "attention").length,
    canSave: staged.length > 0 && staged.every(([, field]) => field.review !== "attention"),
  };
}

function display(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
