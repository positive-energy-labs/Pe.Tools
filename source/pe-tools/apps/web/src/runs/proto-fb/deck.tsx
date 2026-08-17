// THROWAWAY — /runs feedback-loop round 1, variant fb=deck.
// THESIS: staging collects QUIETLY (a floating count chip is all the chrome); a "review N
// staged" verb opens a full-viewport REVIEW DECK — one staged A/B at a time at maximum size,
// flags + note per item, keyboard prev/next — and the export verbs live at the deck's end.
// Checkout flow: collect, then review, then ship.
import { type ComponentType, useEffect, useState } from "react";

import { cn } from "#/lib/utils";

import type { ZoneRecord } from "../world";
import { fb, type StagedItem, useFb } from "./staging";
import { ExportStatus, ExportVerbs, FlagChips, NoteInput, runShort, zoneShort } from "./verbs";

/** The promoted surface's ZonePanel, injected from browser.tsx (no import cycle). */
export type PanelComponent = ComponentType<{
  runId: string;
  zone: ZoneRecord;
  maxW: number;
  maxH: number;
  underlay: boolean;
  fbKey?: string;
}>;

export function DeckChip() {
  const { items, deckOpen } = useFb();
  if (deckOpen) return null;
  if (items.length === 0) {
    return (
      <div
        className="tele fixed bottom-14 left-1/2 z-40 -translate-x-1/2 border bg-background px-2.5 py-1 text-[11px] text-muted-foreground shadow-sm"
        style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
      >
        deck — nothing staged yet
      </div>
    );
  }
  return (
    <div
      className="fixed bottom-14 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 border bg-background px-2 py-1 shadow-md"
      style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
    >
      <span className="tele text-[10px] text-muted-foreground" title={items.map((i) => i.zone).join("\n")}>
        {items.map((i) => zoneShort(i.zone)).join(" · ")}
      </span>
      <button
        type="button"
        onClick={() => fb.setDeckOpen(true)}
        title="Open the review deck — one staged item at a time at full size."
        className="tele border border-transparent bg-primary px-2 py-0.5 text-[11px] text-primary-foreground"
        style={{ borderRadius: 2 }}
      >
        review {items.length} staged →
      </button>
      <button
        type="button"
        onClick={() => fb.clear()}
        title="Unstage everything."
        className="tele text-[10px] text-muted-foreground hover:text-foreground"
      >
        clear
      </button>
    </div>
  );
}

function DeckItem(props: { item: StagedItem; ZonePanel: PanelComponent; underlay: boolean }) {
  const { item, ZonePanel } = props;
  const comparing = item.runA !== null;
  // Proto: size once from the viewport; the deck is a fixed overlay, resize = reopen.
  const availW = window.innerWidth - 64;
  const availH = window.innerHeight - 240;
  const panelW = comparing ? Math.floor((availW - 12) / 2) : availW;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-8">
      <div className="flex min-h-0 flex-1 items-center justify-center gap-3">
        {comparing &&
          (item.a && item.runA ? (
            <div className="flex flex-col gap-1">
              <span className="tele text-[10px] text-muted-foreground">A · baseline · {item.runA}</span>
              <ZonePanel runId={item.runA} zone={item.a} maxW={panelW} maxH={availH} underlay={props.underlay} />
            </div>
          ) : (
            <div className="tele flex items-center justify-center bg-secondary text-[11px] text-muted-foreground" style={{ width: panelW, height: availH, borderRadius: 2 }}>
              not in baseline
            </div>
          ))}
        {item.b ? (
          <div className="flex flex-col gap-1">
            <span className="tele text-[10px] text-muted-foreground">
              B · current · {item.runB} — <span style={{ color: "var(--r-alarm)" }}>click rooms/residues to flag</span>
            </span>
            <ZonePanel runId={item.runB} zone={item.b} maxW={panelW} maxH={availH} underlay={props.underlay} fbKey={item.key} />
          </div>
        ) : (
          <div className="tele flex items-center justify-center bg-secondary text-[11px] text-muted-foreground" style={{ width: panelW, height: availH, borderRadius: 2 }}>
            not in current
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <FlagChips item={item} />
        <div className="w-[28rem]">
          <NoteInput item={item} />
        </div>
      </div>
    </div>
  );
}

export function Deck(props: { pool: string | null; ZonePanel: PanelComponent; underlay: boolean }) {
  const { items, deckOpen } = useFb();
  const [index, setIndex] = useState(0);
  const atExport = index >= items.length;

  useEffect(() => {
    if (!deckOpen) setIndex(0);
  }, [deckOpen]);

  useEffect(() => {
    if (!deckOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /input|textarea|select/i.test(t.tagName)) {
        if (e.key === "Escape") (t as HTMLInputElement).blur();
        return;
      }
      if (e.key === "Escape") fb.setDeckOpen(false);
      if (e.key === "ArrowRight") setIndex((i) => Math.min(items.length, i + 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") e.stopImmediatePropagation();
    };
    // Capture so the deck beats the fb switcher's arrow keys while open.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [deckOpen, items.length]);

  if (!deckOpen) return null;
  const item = items[index];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background py-3">
      <div className="flex shrink-0 items-baseline gap-3 px-8 pb-2">
        <span className="tele-label text-muted-foreground">review deck</span>
        {!atExport && item ? (
          <>
            <span className="tele text-sm font-semibold">{item.zone}</span>
            <span className="tele text-[11px] text-muted-foreground">
              A {runShort(item.runA)} → B {runShort(item.runB)}
            </span>
          </>
        ) : (
          <span className="tele text-sm font-semibold">export the staged set</span>
        )}
        <span className="tele ml-auto text-[11px] text-muted-foreground">
          {Math.min(index + 1, items.length + 1)} / {items.length + 1} · ←/→ · esc closes
        </span>
        <button
          type="button"
          onClick={() => fb.setDeckOpen(false)}
          title="Close the deck (staging is kept)."
          className="tele border px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
        >
          ✕ close
        </button>
      </div>

      {atExport ? (
        <div className="mx-auto flex w-[36rem] flex-col gap-3 pt-10">
          <div className="flex flex-col gap-1 border p-3" style={{ borderColor: "var(--line-2)", borderRadius: 2 }}>
            {items.map((i) => (
              <div key={i.key} className="tele flex items-baseline gap-2 text-[11px]">
                <span className="font-semibold">{zoneShort(i.zone)}</span>
                <span className="text-muted-foreground">
                  {i.flags.length} flag{i.flags.length === 1 ? "" : "s"}
                </span>
                <span className="truncate text-muted-foreground">{i.note.trim() || "(no note)"}</span>
              </div>
            ))}
          </div>
          <ExportVerbs items={items} pool={props.pool} />
          <ExportStatus />
        </div>
      ) : item ? (
        <DeckItem item={item} ZonePanel={props.ZonePanel} underlay={props.underlay} />
      ) : null}

      <div className="flex shrink-0 items-center justify-center gap-2 pt-2">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          className="tele border px-2 py-0.5 text-[11px] text-muted-foreground disabled:opacity-30"
          style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
        >
          ← prev
        </button>
        {items.map((i, n) => (
          <button
            key={i.key}
            type="button"
            onClick={() => setIndex(n)}
            title={i.zone}
            className={cn("size-2 rounded-full", n === index ? "bg-foreground" : "bg-muted-foreground/30")}
          />
        ))}
        <button
          type="button"
          onClick={() => setIndex(items.length)}
          title="Jump to the export step."
          className={cn("size-2 rounded-full", atExport ? "bg-foreground" : "bg-muted-foreground/30")}
        />
        <button
          type="button"
          disabled={atExport}
          onClick={() => setIndex((i) => Math.min(items.length, i + 1))}
          className="tele border px-2 py-0.5 text-[11px] text-muted-foreground disabled:opacity-30"
          style={{ borderColor: "var(--line-2)", borderRadius: 2 }}
        >
          {index === items.length - 1 ? "export →" : "next →"}
        </button>
      </div>
    </div>
  );
}
