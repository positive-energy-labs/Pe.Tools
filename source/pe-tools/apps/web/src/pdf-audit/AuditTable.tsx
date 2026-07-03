import { Check, Undo2, X } from "lucide-react";
import { useState } from "react";

import { Input } from "#/components/ui/input";
import { cellKey } from "#/pdf-audit/types";
import { usePdfAudit } from "#/pdf-audit/store";
import { cn } from "#/lib/utils";

export interface AuditRow {
  name: string;
  /** small caption under the name, e.g. "Shared · inst · Length" */
  caption?: string;
  formula?: string;
  readOnly?: boolean;
}

/**
 * Parameters as rows, family types as columns. Hovering a cell whose value was
 * mapped from the PDF grounds it in the PdfPane (bbox highlight + markdown
 * block). Click a cell to stage an edit; proposal chips accept/reject inline.
 */
export function AuditTable({
  rows,
  columns,
  current,
}: {
  rows: AuditRow[];
  columns: string[];
  current: Record<string, Record<string, string>>;
}) {
  const { hoverCell } = usePdfAudit();

  if (rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border/60 bg-muted/20 px-3 py-8 text-center text-sm text-muted-foreground">
        No parameters to audit yet
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-border/60 bg-background">
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-20">
          <tr>
            <th className="sticky left-0 z-30 min-w-[220px] border-r border-b border-border/60 bg-muted/80 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur">
              Parameter
            </th>
            {columns.map((column) => (
              <th
                key={column}
                className="min-w-[140px] border-r border-b border-border/60 bg-muted/70 px-3 py-2 text-xs font-semibold text-foreground backdrop-blur"
                title={column}
              >
                <span className="block max-w-[200px] truncate">{column}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody onMouseLeave={() => hoverCell(null)}>
          {rows.map((row) => (
            <tr key={row.name} className="group/row">
              <td className="sticky left-0 z-10 border-r border-b border-border/40 bg-background px-3 py-1.5 align-top">
                <p className="text-xs font-medium text-foreground">{row.name}</p>
                {row.caption && <p className="text-[10px] text-muted-foreground">{row.caption}</p>}
                {row.formula && (
                  <p
                    className="truncate font-mono text-[10px] text-[var(--cat-lichen)]"
                    title={row.formula}
                  >
                    = {row.formula}
                  </p>
                )}
              </td>
              {columns.map((column) => (
                <AuditCell
                  key={column}
                  row={row}
                  column={column}
                  currentValue={current[row.name]?.[column] ?? ""}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditCell({
  row,
  column,
  currentValue,
}: {
  row: AuditRow;
  column: string;
  currentValue: string;
}) {
  const { proposals, edits, hoverCell, acceptProposal, rejectProposal, stageEdit, clearEdit } =
    usePdfAudit();
  const key = cellKey(row.name, column);
  const proposal = proposals.get(key);
  const edit = edits.get(key);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const displayed = edit ?? currentValue;
  const isEdited = edit !== undefined && edit !== currentValue;
  const proposalMatchesCurrent = proposal !== undefined && proposal.value === displayed;
  const editable = !row.readOnly && !row.formula;

  const startEditing = () => {
    if (!editable) return;
    setDraft(displayed);
    setEditing(true);
  };

  return (
    <td
      onMouseEnter={() => hoverCell(key)}
      className={cn(
        "border-r border-b border-border/40 px-2 py-1.5 align-top font-mono text-xs tracking-tight transition-colors",
        proposal && !proposalMatchesCurrent && "bg-[var(--cat-blue)]/6",
        proposal && "cursor-help",
        isEdited && "bg-[var(--cat-green)]/8",
        !editable && "text-muted-foreground",
      )}
    >
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              if (draft === currentValue) clearEdit(key);
              else stageEdit(key, draft);
              setEditing(false);
            }
            if (event.key === "Escape") setEditing(false);
          }}
          className="h-6 px-1.5 font-mono text-xs"
        />
      ) : (
        <div className="flex min-h-5 flex-col gap-0.5">
          <button
            type="button"
            onClick={startEditing}
            className={cn(
              "flex items-center gap-1 text-left",
              editable && "cursor-text",
              !displayed.trim() && "text-muted-foreground/40",
            )}
            title={editable ? "Click to edit" : row.formula ? "Formula-driven" : "Read-only"}
          >
            <span className={cn("truncate", isEdited && "font-semibold text-[var(--cat-green)]")}>
              {displayed.trim() ? displayed : "—"}
            </span>
            {isEdited && (
              <Undo2
                className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100"
                onClick={(event) => {
                  event.stopPropagation();
                  clearEdit(key);
                }}
              />
            )}
          </button>

          {proposal && !proposalMatchesCurrent && (
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  "truncate rounded px-1 py-px text-[11px]",
                  proposal.confidence === "high" &&
                    "bg-[var(--cat-blue)]/15 text-[var(--cat-blue)]",
                  proposal.confidence === "medium" &&
                    "bg-[var(--cat-blue)]/10 text-[var(--cat-blue)]/85",
                  proposal.confidence === "low" && "bg-muted text-muted-foreground",
                )}
                title={proposal.note ?? `From PDF (${proposal.confidence} confidence)`}
              >
                → {proposal.value}
              </span>
              <button
                type="button"
                onClick={() => acceptProposal(key)}
                title="Accept proposed value"
                className="rounded p-0.5 text-[var(--cat-green)] hover:bg-[var(--cat-green)]/15"
              >
                <Check className="size-3" />
              </button>
              <button
                type="button"
                onClick={() => rejectProposal(key)}
                title="Reject proposed value"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted"
              >
                <X className="size-3" />
              </button>
            </span>
          )}
          {proposalMatchesCurrent && (
            <span
              className="w-fit rounded bg-[var(--cat-green)]/12 px-1 py-px text-[10px] text-[var(--cat-green)]"
              title="PDF agrees with the current value"
            >
              ✓ matches PDF
            </span>
          )}
        </div>
      )}
    </td>
  );
}
