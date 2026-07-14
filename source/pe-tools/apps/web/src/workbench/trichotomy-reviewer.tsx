/**
 * CellTrichotomyReviewer — the shared inline reviewer for every trichotomy route
 * (settings fields, schedule-grid cells, family-types cells). It renders the list of
 * reviewable cells (open proposal → staged) with approve / deny / undo controls, the
 * summary/attention line, and the human-only commit button — plus the busy/error and
 * route-state write plumbing every plugin used to duplicate.
 *
 * Differences are prop-driven: the per-key label (`renderLabel`), value rendering
 * (`renderValue`), the state segment (`cells` vs `fields`), and the commit command /
 * labels. Summary counts come from `cellSummary` in @pe/agent-contracts — no local
 * summary logic. Staging is uniform now that `staged` is a `{ value } | null` presence
 * object: approve sets `staged` + review "good"; deny drops the proposal; undo drops
 * `staged` and clears the review.
 */
import { useState, type ReactNode } from "react";
import { Check, RotateCcw, X } from "lucide-react";

import { type CellReview, cellSummary, stagedEntries } from "@pe/agent-contracts";

import { Button } from "#/components/ui/button";
import { useWorkbench } from "./provider";
import { type RouteStateWriteResult, writeRouteState } from "./route-state";

/** The minimal cell shape the reviewer reads — every route cell satisfies it. */
export interface ReviewerCell {
  // `value` is optional because the settings/schedule schemas widen the proposal to an
  // index-signature object (the trichotomy extension-spread wart); a required `value`
  // would reject them. TrichotomyCellLike-compatible so `cellSummary` accepts these cells.
  proposal?: { value?: unknown; confidence?: "high" | "low" | null; note?: string | null } | null;
  staged?: { value: unknown } | null;
  review: CellReview;
}

export interface CellTrichotomyReviewerProps {
  /** Dispatcher route name, e.g. "settings" | "schedule-grid" | "family-types". */
  route: string;
  /** State segment holding the cells: "cells" for most routes, "fields" for settings. */
  segment: string;
  /** All cells in the segment (the reviewer filters/summarizes them). */
  cells: Record<string, ReviewerCell>;
  /** The human-only commit command, e.g. "save" | "push". */
  commitCommand: string;
  /** Commit button label, given the staged count (e.g. `Save 3`, `Push 3 to Revit`). */
  commitLabel: (stagedCount: number) => ReactNode;
  /** Idle hint shown in the summary line when nothing needs attention. */
  reviewHint: string;
  /** Per-key row label (route-specific: field path / row·col / param·type). */
  renderLabel: (key: string, cell: ReviewerCell) => ReactNode;
  /** Value renderer (defaults to a string cast; settings passes a JSON-aware display). */
  renderValue?: (value: unknown) => ReactNode;
}

export function CellTrichotomyReviewer({
  route,
  segment,
  cells,
  commitCommand,
  commitLabel,
  reviewHint,
  renderLabel,
  renderValue = defaultRenderValue,
}: CellTrichotomyReviewerProps) {
  const { config } = useWorkbench();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const items = Object.entries(cells).filter(
    ([, cell]) => cell.proposal != null || cell.staged != null,
  );
  const summary = cellSummary(cells);
  const stagedCount = stagedEntries(cells).length;
  const canCommit =
    stagedCount > 0 && stagedEntries(cells).every(([, cell]) => cell.review !== "attention");

  const write = async (key: string, suffix: "apply" | "command", body: Record<string, unknown>) => {
    setBusy(key);
    try {
      const result = await writeRouteState(config, route, suffix, body);
      setError(commandFailureNote(result));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Route update failed.");
    } finally {
      setBusy(null);
    }
  };

  const approve = (key: string, cell: ReviewerCell) =>
    void write(key, "apply", {
      patches: [
        { path: [segment, key, "staged"], value: { value: cell.proposal?.value } },
        { path: [segment, key, "review"], value: "good" },
      ],
    });
  const deny = (key: string) =>
    void write(key, "apply", {
      patches: [
        { path: [segment, key, "proposal"] },
        { path: [segment, key, "review"], value: "none" },
      ],
    });
  const undo = (key: string) =>
    void write(key, "apply", {
      patches: [
        { path: [segment, key, "staged"] },
        { path: [segment, key, "review"], value: "none" },
      ],
    });

  return (
    <div className="mt-1.5 w-full border-t border-[var(--line-2)]">
      <div className="max-h-64 overflow-y-auto">
        {items.map(([key, cell]) => {
          const staged = cell.staged != null;
          return (
            <div
              key={key}
              className="flex min-h-12 items-center gap-2 border-b border-[var(--line-2)] py-1.5 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[var(--clay-ink)]">
                  {renderLabel(key, cell)}
                </div>
                <div className="truncate text-[var(--slate)]">
                  {renderValue(staged ? cell.staged?.value : cell.proposal?.value)}
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
                  onClick={() => undo(key)}
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
                    onClick={() => deny(key)}
                  >
                    <X />
                  </Button>
                  <Button
                    size="icon-sm"
                    title="Approve and stage suggestion"
                    disabled={busy != null || !cell.proposal}
                    onClick={() => approve(key, cell)}
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
            (summary.attention > 0
              ? `${summary.attention} value${summary.attention === 1 ? " needs" : "s need"} review`
              : reviewHint)}
        </span>
        <Button
          size="sm"
          disabled={!canCommit || busy != null}
          onClick={() => void write("__commit", "command", { command: commitCommand, input: {} })}
        >
          <Check />
          {commitLabel(stagedCount)}
        </Button>
      </div>
    </div>
  );
}

function defaultRenderValue(value: unknown): ReactNode {
  return typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
}

/** Surface a rejected write (error/hint) or a successful command's per-cell failures. */
function commandFailureNote(result: RouteStateWriteResult): string | null {
  if (!result.ok) return result.error ?? result.hint ?? "Route update failed.";
  const payload = result.result;
  if (typeof payload !== "object" || payload == null) return null;
  const failures = (payload as { failures?: unknown }).failures;
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const first = failures[0] as { key?: string; error?: string };
  const detail = [first?.key, first?.error].filter((part) => typeof part === "string").join(": ");
  return `${failures.length} value${failures.length === 1 ? "" : "s"} failed${detail ? `: ${detail}` : "."}`;
}
