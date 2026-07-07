import { createFileRoute } from "@tanstack/react-router";
import { CheckCheck, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { DocPane } from "#/family-sheet/DocPane";
import { LiveFamilySheetProvider } from "#/family-sheet/live";
import type { CellFocus } from "#/family-sheet/SheetCell";
import { SheetGrid } from "#/family-sheet/SheetGrid";
import {
  MockFamilySheetProvider,
  canPush,
  stagedEntries,
  useFamilySheet,
} from "#/family-sheet/store";
import { HostConnectionPill } from "#/host/issues";

/**
 * /family-sheet — an editable mirror of a Revit family's parameter state (a
 * functional clone of Revit's Family Types dialog). pea proposes values scraped
 * from a manufacturer spec sheet; the engineer reviews, edits, and pushes to
 * Revit. Renders exclusively against FamilySheetStore: the live provider
 * (AgentController session state + host RPC) by default, `?mock` for the
 * self-contained demo.
 */
export const Route = createFileRoute("/family-sheet")({
  validateSearch: (search: Record<string, unknown>) => ({
    mock: search.mock != null && search.mock !== false ? true : undefined,
  }),
  component: FamilySheetRoute,
});

function FamilySheetRoute() {
  const { mock } = Route.useSearch();
  const Provider = mock ? MockFamilySheetProvider : LiveFamilySheetProvider;
  return (
    <Provider>
      <FamilySheetPage />
    </Provider>
  );
}

function FamilySheetPage() {
  const store = useFamilySheet();
  const { worksheet, grounding, status } = store;
  const snapshot = worksheet.snapshot;

  const [focus, setFocus] = useState<CellFocus | null>(null);

  // Esc unpins / clears focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const staged = stagedEntries(worksheet);
  const stagedCount = staged.length;
  // only staged cells gate the push — unstaged attention marks are advisory
  const attention = staged.filter(([, cell]) => cell.review === "attention").length;
  const pushable = canPush(worksheet);

  // resolve the focused cell's proposal → doc source
  const focusInfo = useMemo(() => {
    if (!focus) return { source: null, value: null as string | null, note: null as string | null };
    const cell = worksheet.cells[focus.key];
    const proposal = cell?.proposal ?? null;
    return {
      source: proposal?.source ?? null,
      value: proposal?.value ?? null,
      note: proposal?.note ?? null,
    };
  }, [focus, worksheet.cells]);

  const paramCount = snapshot?.parameters.length ?? 0;
  const typeCount = snapshot?.typeNames.length ?? 0;

  const pushBlockedReason = !pushable
    ? stagedCount === 0
      ? "nothing staged"
      : attention > 0
        ? `${attention} cell${attention === 1 ? "" : "s"} need attention`
        : undefined
    : undefined;

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-[var(--paper)]">
      {/* ── header ribbon ── */}
      <header className="shrink-0 border-b border-[var(--line-2)] px-5 pb-2.5 pt-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
              {snapshot?.familyName ?? "Family Sheet"}
            </h1>
            <span className="text-xs text-muted-foreground">
              {snapshot
                ? `${typeCount} type${typeCount === 1 ? "" : "s"} · ${paramCount} parameters`
                : "no family read"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <HostConnectionPill connected={status.bridgeConnected} label="Bridge connected" />
            {status.peaActive && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pea-tint)] px-2 py-0.5 text-xs font-medium text-[var(--cat-green)]">
                <Sparkles className="size-3 animate-pulse" />
                pea is working…
              </span>
            )}

            <Button
              variant="outline"
              size="sm"
              disabled={status.reading}
              onClick={() => void store.readFamily()}
            >
              <RefreshCw className={status.reading ? "animate-spin" : ""} />
              {snapshot ? "Re-read family" : "Read family"}
            </Button>

            {store.simulatePea && (
              <Button
                variant="outline"
                size="sm"
                disabled={status.peaActive}
                onClick={() => store.simulatePea?.()}
              >
                <Sparkles />
                Simulate pea
              </Button>
            )}

            <Button
              size="sm"
              disabled={!pushable || status.pushing}
              onClick={() => void store.push()}
              title={pushBlockedReason}
              className="bg-[var(--cat-green)] text-white hover:bg-[var(--cat-green)]/85 disabled:opacity-50"
            >
              {status.pushing ? <Loader2 className="animate-spin" /> : <CheckCheck />}
              {status.pushing ? "Pushing…" : `Push ${stagedCount} to Revit`}
            </Button>
          </div>
        </div>

        {/* ribbon subline: gate reason / last push / error */}
        <div className="mt-1.5 flex items-center gap-3 text-[11px]">
          {pushBlockedReason && stagedCount > 0 && (
            <span className="text-[var(--cat-clay)]">Push blocked · {pushBlockedReason}</span>
          )}
          {store.lastPush && !status.pushing && (
            <span className="text-[var(--cat-green)]">
              Pushed {store.lastPush.applied} to Revit
              {store.lastPush.failures.length > 0 && ` · ${store.lastPush.failures.length} failed`}
            </span>
          )}
          {status.error && <span className="text-[var(--cat-clay)]">{status.error}</span>}
        </div>
      </header>

      {/* ── two panes ── */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <SheetGrid focus={focus} setFocus={setFocus} />
        </div>
        <div className="w-[46%] shrink-0">
          {grounding && worksheet.doc ? (
            <DocPane
              grounding={grounding}
              source={focusInfo.source}
              value={focusInfo.value}
              measuredHint={focusInfo.note}
            />
          ) : (
            <ParseSpecEmptyState />
          )}
        </div>
      </div>
    </main>
  );
}

/** Doc-pane empty state doubling as the parse entry point (URL or file). */
function ParseSpecEmptyState() {
  const store = useFamilySheet();
  const [url, setUrl] = useState("");
  const parsing = store.status.parsing;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 border-l border-[var(--line)] bg-[color-mix(in_srgb,var(--basalt)_88%,var(--pe-blue))] px-8">
      <p className="text-xs text-muted-foreground">
        {parsing ? "Parsing spec sheet (takes a minute or two)…" : worksheetDocHint}
      </p>
      {parsing ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <>
          <div className="flex w-full max-w-md items-center gap-2">
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…/datasheet.pdf"
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-white/70 px-2.5 text-xs outline-none focus:border-[var(--pea-line)]"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={!url.trim()}
              onClick={() => void store.parseSpec({ url: url.trim() })}
            >
              Parse
            </Button>
          </div>
          <label className="cursor-pointer text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            or upload a PDF
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void store.parseSpec({ file });
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}

const worksheetDocHint =
  "No spec sheet parsed — paste a datasheet URL, upload a PDF, or ask pea to do it.";
