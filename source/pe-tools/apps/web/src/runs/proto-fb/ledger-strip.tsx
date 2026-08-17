// THROWAWAY — /runs feedback-loop round 1, variant fb=ledger.
// THESIS: staging RIDES THE LEDGER dock — staged items appear as marked entries in the bottom
// dock beside their runs, and the dock grows the export verbs. No new chrome regions.
//
// DEVIATION (round finding, keep in the close notes): the brief wanted annotation in the
// existing zone-peek floater, but the peek is pointer-events-none and hover-transient — it is a
// READ surface; putting a text input on it means pinning + pointer-events surgery on the
// promoted plan dock, which this round is not allowed to restyle. Notes therefore live inline
// in the dock rows; flags stay on the card SVGs (shared plumbing).
import { fb, useFb } from "./staging";
import { ExportStatus, ExportVerbs, FlagChips, NoteInput, runShort, zoneShort } from "./verbs";

export function LedgerStrip(props: { pool: string | null }) {
  const { items } = useFb();
  return (
    <div className="shrink-0 border-t" style={{ borderColor: "var(--line-2)" }}>
      <div className="flex items-baseline gap-2 px-3 py-1">
        <span className="tele-label" style={{ color: "var(--r-alarm)" }}>
          staged for export
        </span>
        <span className="tele text-[11px] text-muted-foreground">
          {items.length === 0
            ? "none — hit stage on a zone card; entries collect here beside their runs"
            : `${items.length} item${items.length === 1 ? "" : "s"}`}
        </span>
        <span className="ml-auto flex items-center gap-2">
          {items.length > 0 && (
            <button
              type="button"
              onClick={() => fb.clear()}
              title="Unstage everything."
              className="tele text-[10px] text-muted-foreground hover:text-foreground"
            >
              clear
            </button>
          )}
          <ExportVerbs items={items} pool={props.pool} compact />
        </span>
      </div>
      {items.length > 0 && (
        <div className="flex flex-col">
          {items.map((item) => (
            <div
              key={item.key}
              className="flex items-center gap-2 border-t px-3 py-1"
              style={{ borderColor: "var(--line-soft, var(--line-2))" }}
            >
              <span className="tele w-14 shrink-0 text-[11px] font-semibold" title={item.zone}>
                {zoneShort(item.zone)}
              </span>
              <span className="tele w-40 shrink-0 text-[10px] text-muted-foreground" title={`A=${item.runA ?? "(none)"} B=${item.runB}`}>
                A {runShort(item.runA)} → B {runShort(item.runB)}
              </span>
              <span className="w-64 shrink-0 overflow-hidden">
                <FlagChips item={item} />
              </span>
              <span className="min-w-0 flex-1">
                <NoteInput item={item} />
              </span>
              <button
                type="button"
                onClick={() => fb.unstage(item.key)}
                title="Remove this item from the staged set."
                className="tele shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="px-3 pb-1">
        <ExportStatus />
      </div>
    </div>
  );
}
