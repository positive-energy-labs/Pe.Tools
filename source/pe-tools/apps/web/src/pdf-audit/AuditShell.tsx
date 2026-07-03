import { Loader2, Sparkles, Wand2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import { PdfPane } from "#/pdf-audit/PdfPane";
import { usePdfAudit } from "#/pdf-audit/store";
import { cn } from "#/lib/utils";

/**
 * Split audit layout: table on the left, PDF grounding pane on the right.
 * The header carries route-specific pickers/actions; the ribbon reports
 * mapping engine, proposal and staged-edit counts.
 */
export function AuditShell({
  title,
  subtitle,
  headerControls,
  ribbonExtra,
  onRunMapping,
  canRunMapping,
  children,
}: {
  title: string;
  subtitle: string;
  headerControls?: React.ReactNode;
  ribbonExtra?: React.ReactNode;
  onRunMapping: () => void;
  canRunMapping: boolean;
  children: React.ReactNode;
}) {
  const { doc, mapStatus, proposals, edits, acceptAllProposals, clearAllEdits } = usePdfAudit();

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerControls}
          <Button
            size="sm"
            onClick={onRunMapping}
            disabled={!canRunMapping || !doc || mapStatus.phase === "mapping"}
            title={
              !doc
                ? "Upload a PDF first"
                : !canRunMapping
                  ? "Load parameter data first"
                  : "Ask the agent to map the PDF onto the table"
            }
          >
            {mapStatus.phase === "mapping" ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Wand2 className="size-3" />
            )}
            Map PDF → table
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/40 bg-muted/20 px-4 py-1.5 text-xs text-muted-foreground">
        {mapStatus.phase === "ready" && (
          <span className="flex items-center gap-1 text-[var(--cat-blue)]">
            <Sparkles className="size-3" />
            {mapStatus.engine === "anthropic" ? "Agent-mapped" : "Heuristic-mapped"}
          </span>
        )}
        {mapStatus.phase === "ready" && mapStatus.note && (
          <span title={mapStatus.note}>{mapStatus.note}</span>
        )}
        {mapStatus.phase === "error" && (
          <span className="text-[var(--cat-clay)]">Mapping failed: {mapStatus.message}</span>
        )}
        <span className={cn(proposals.size > 0 && "text-foreground")}>
          {proposals.size} proposal{proposals.size !== 1 ? "s" : ""}
        </span>
        {proposals.size > 0 && (
          <Button variant="ghost" size="xs" onClick={acceptAllProposals}>
            Accept all
          </Button>
        )}
        <span className={cn(edits.size > 0 && "font-medium text-[var(--cat-green)]")}>
          {edits.size} staged edit{edits.size !== 1 ? "s" : ""}
        </span>
        {edits.size > 0 && (
          <Button variant="ghost" size="xs" onClick={clearAllEdits}>
            Discard edits
          </Button>
        )}
        {ribbonExtra}
      </div>

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-auto p-3">{children}</section>
        <aside className="w-[42%] min-w-[360px] max-w-[640px] border-l border-border/60">
          <PdfPane />
        </aside>
      </div>
    </main>
  );
}
