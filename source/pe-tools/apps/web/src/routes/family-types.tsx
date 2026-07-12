import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCheck,
  FileUp,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { DocPane, UploadSurface } from "#/family-types/DocPane";
import { Grid } from "#/family-types/Grid";
import { Inspector } from "#/family-types/Inspector";
import type { CellFocus } from "#/family-types/Cell";
import { LiveFamilyTypesProvider } from "#/family-types/live";
import {
  MockFamilyTypesProvider,
  canPush,
  stagedEntries,
  useFamilyTypes,
} from "#/family-types/store";
import { HostConnectionPill } from "#/host/issues";

/**
 * /family-types — a web replacement for Revit's Family Types dialog. pea proposes
 * parameter values scraped from a manufacturer spec sheet; the engineer reviews,
 * stages, and pushes to Revit. All collaborative state lives in the `route:family-types`
 * document, written through the route-state dispatcher as `actor:"human"`. Renders
 * against FamilyTypesStore: the live provider by default, `?mock` for the self-contained
 * demo.
 */
export const Route = createFileRoute("/family-types")({
  validateSearch: (search: Record<string, unknown>) => ({
    mock: search.mock != null && search.mock !== false ? true : undefined,
  }),
  component: FamilyTypesRoute,
});

function FamilyTypesRoute() {
  const { mock } = Route.useSearch();
  const Provider = mock ? MockFamilyTypesProvider : LiveFamilyTypesProvider;
  return (
    <Provider>
      <FamilyTypesPage />
    </Provider>
  );
}

function FamilyTypesPage() {
  const store = useFamilyTypes();
  const { document, grounding, status } = store;
  const snapshot = document.snapshot;

  const [focus, setFocus] = useState<CellFocus | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [rightOpen, setRightOpen] = useState(true);

  // Esc unpins/clears grounding focus, then clears selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setFocus((f) => (f ? null : f));
      setSelected((s) => (focus ? s : null));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  const select = (name: string) => {
    setSelected(name);
    setRightOpen(true);
  };

  const staged = stagedEntries(document);
  const stagedCount = staged.length;
  const attention = staged.filter(([, cell]) => cell.review === "attention").length;
  const pushable = canPush(document);

  // Resolve the focused cell's proposal → doc source for the camera.
  const focusInfo = useMemo(() => {
    const cell = focus ? document.cells[focus.key] : undefined;
    const proposal = cell?.proposal ?? null;
    return {
      source: proposal?.source ?? null,
      value: proposal?.value ?? null,
      note: proposal?.note ?? null,
    };
  }, [focus, document.cells]);

  const paramCount = snapshot?.parameters.length ?? 0;
  const typeCount = snapshot?.typeNames.length ?? 0;
  const takenAgo = snapshot?.takenAt ? timeAgo(snapshot.takenAt) : null;

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
              {snapshot?.familyName ?? "Family Types"}
            </h1>
            <span className="text-xs text-muted-foreground">
              {snapshot
                ? `${typeCount} type${typeCount === 1 ? "" : "s"} · ${paramCount} parameters${
                    takenAgo ? ` · read ${takenAgo}` : ""
                  }`
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

            <Button
              variant="outline"
              size="sm"
              onClick={() => setRightOpen(true)}
              title="upload / focus the spec sheet"
            >
              <FileUp />
              Upload spec
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

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRightOpen((v) => !v)}
              title={rightOpen ? "hide spec pane" : "show spec pane"}
            >
              {rightOpen ? <PanelRightClose /> : <PanelRightOpen />}
            </Button>
          </div>
        </div>

        {/* ribbon subline: gate reason / last push / hint / error */}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
          {pushBlockedReason && stagedCount > 0 && (
            <span className="text-[var(--cat-clay)]">Push blocked · {pushBlockedReason}</span>
          )}
          {store.lastPush && !status.pushing && (
            <span className="text-[var(--cat-green)]">
              Pushed {store.lastPush.applied} to Revit
              {store.lastPush.failures.length > 0 && ` · ${store.lastPush.failures.length} failed`}
            </span>
          )}
          {status.hint && <span className="text-[var(--cat-clay)]">{status.hint}</span>}
          {status.error && !status.hint && (
            <span className="text-[var(--cat-clay)]">{status.error}</span>
          )}
        </div>
      </header>

      {/* ── zones: grid · (doc pane / inspector) ── */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <Grid focus={focus} setFocus={setFocus} selected={selected} onSelect={select} />
        </div>

        {rightOpen && (
          <div className="flex w-[40%] min-w-0 shrink-0 flex-col">
            <div className="min-h-0 flex-1">
              {grounding && document.doc ? (
                <DocPane
                  grounding={grounding}
                  source={focusInfo.source}
                  value={focusInfo.value}
                  measuredHint={focusInfo.note}
                />
              ) : (
                <UploadSurface />
              )}
            </div>
            {selected && (
              <div className="h-[42%] min-h-0 shrink-0">
                <Inspector
                  paramName={selected}
                  onSelect={select}
                  onClose={() => setSelected(null)}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

/** Compact relative-time label for the snapshot's takenAt. */
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}
