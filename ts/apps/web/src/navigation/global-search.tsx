import { useLayoutEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CommandPalette } from "@pe/kit/lang/list-popup";
import { Button } from "@pe/kit/lang/button";
import { KeyHint } from "@pe/kit/lang/key-hint";
import { useNavigation } from "./state";
import type { ResultKind } from "./global-items";
import { friendlyObservation } from "./model";
import { useLedgerList } from "./ledger";
import { LEDGER_PRESENTATIONS } from "./ledger-model";

/** Ctrl+Shift+K: the open-work ledger under the route field; tools, Works and threads join as you type. */
export function GlobalSearch({
  open,
  onOpenChange,
  anchor,
  query,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor: HTMLElement | null;
  query: string;
}) {
  const { snapshot, loading, error, refresh } = useNavigation();
  const [kind, setKind] = useState<ResultKind>("All");
  const ledger = useLedgerList(LEDGER_PRESENTATIONS.overlay, query, kind);
  // Unfolding a lane is a pick that stays in the palette.
  const stay = useRef(false);
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
    <CommandPalette
      {...ledger.props}
      open={open}
      onOpenChange={(next) => {
        if (!next && stay.current) {
          stay.current = false;
          return;
        }
        onOpenChange(next);
      }}
      presentation="anchored"
      anchor={anchor}
      owner={anchor?.querySelector("input")}
      sideOffset={sideOffset}
      searchAbove={0}
      maxHeight="min(32rem, 60dvh)"
      onPick={(item) => {
        stay.current = item.kind === "note";
        ledger.props.onPick(item);
      }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-1">
          <span className="flex flex-wrap gap-1">
            {(["All", "Tools", "Works", "Pea threads"] as const).map((value) => (
              <Button
                key={value}
                label={
                  value === "All" ? "Open work, then everything as you type" : `Search ${value}`
                }
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
            <KeyHint>↑↓</KeyHint> move <KeyHint hotkey="Enter" /> open <KeyHint hotkey="Escape" />{" "}
            close
          </span>
          {ledger.refusal && <p className="w-full text-ink-2">{ledger.refusal}</p>}
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
