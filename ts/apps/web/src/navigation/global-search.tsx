import { useLayoutEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CommandPalette } from "#/components/lang/command-palette";
import { Button } from "#/components/lang/button";
import { Kbd } from "#/components/lang/kbd";
import { useNavigation } from "./state";
import { globalItems, type Destination, type ResultKind } from "./global-items";
import { friendlyObservation } from "./model";

export function GlobalSearch({
  open,
  onOpenChange,
  onNavigate,
  anchor,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (url: string) => void;
  anchor: HTMLElement | null;
  query: string;
}) {
  const { snapshot, loading, error, refresh } = useNavigation();
  const [kind, setKind] = useState<ResultKind>("All");
  const [sideOffset, setSideOffset] = useState(4);
  useLayoutEffect(() => {
    const bar = anchor?.closest("nav");
    if (!open || !anchor || !bar) return;
    const measure = () =>
      setSideOffset(
        Math.max(4, bar.getBoundingClientRect().bottom - anchor.getBoundingClientRect().bottom + 4),
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [open, anchor]);
  return (
    <CommandPalette<Destination>
      open={open}
      onOpenChange={onOpenChange}
      presentation="anchored"
      anchor={anchor}
      owner={anchor?.querySelector("input")}
      sideOffset={sideOffset}
      query={query}
      aria-label="Find anything"
      items={globalItems(snapshot, kind)}
      keyOf={(row) => row.key}
      labelOf={(row) => `${row.label} ${row.context} ${row.aliases} ${row.state}`}
      groupOf={(row) => row.kind}
      filter="fuzzy"
      searchAbove={0}
      searchPlaceholder="Search tools, Works and Pea threads"
      empty={loading ? "Reading saved inventory…" : "No observed records in this scope"}
      noMatch="No matching tools, Works or Pea threads"
      maxHeight="min(32rem, 60dvh)"
      onPick={(row) => {
        if (row.url) onNavigate(row.url);
      }}
      row={(row) => ({
        label: row.label,
        aside: row.context,
        meta: row.state,
        title: `${row.context} · ${row.state}${row.reason ? ` · ${row.reason}` : ""}`,
        refusal:
          row.kind === "Works" && (loading || error)
            ? "Refresh inventory before resuming Work"
            : row.url
              ? undefined
              : (row.reason ?? "No resumable destination"),
      })}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
          <span className="flex flex-wrap gap-1">
            {(["All", "Tools", "Works", "Pea threads"] as const).map((value) => (
              <Button
                key={value}
                label={`Search ${value}`}
                pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {value}
              </Button>
            ))}
          </span>
          <Button
            label="Refresh search inventory"
            icon={RefreshCw}
            busy={loading}
            onClick={refresh}
          />
          <span className="flex items-center gap-1 t-small text-ink-2">
            <Kbd>↑↓</Kbd> move <Kbd hotkey="Enter" /> open <Kbd hotkey="Escape" /> close
          </span>
          {error && (
            <p className="w-full text-ink-2">
              Inventory unavailable; cached Work resume is paused. {error}
            </p>
          )}
          {snapshot?.truncated && (
            <p className="w-full text-ink-2">Saved inventory is bounded; more records may exist.</p>
          )}
          {snapshot?.observations.map((observation) => (
            <p key={observation} className="w-full t-small text-ink-2">
              {friendlyObservation(observation)}
            </p>
          ))}
        </div>
      }
    />
  );
}
