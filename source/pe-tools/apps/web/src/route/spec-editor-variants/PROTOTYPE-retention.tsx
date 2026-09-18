/**
 * PROTOTYPE — THROWAWAY (protoui round, interaction, 2026-09-18). Delete after the verdict.
 * "I typed, then I clicked another member." `?variant=0|A|B` on `/pods`.
 *   0 — today: the draft dies with the editor.
 *   A — the draft stays with its member; the member list marks it; nothing speaks.
 *   B — same retention, and the switch says what it left behind, with exits.
 * Retention here is PAGE-LIFETIME React state on the fixture lane only. It is NOT the canonical
 * thread draft Work; that contract belongs to authority/execution and is not decided here.
 */
import { useCallback, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

import { OutcomeLine } from "#/components/lang/outcome";
import { Press } from "#/components/lang/press";

export type RetentionVariant = "0" | "A" | "B";
export interface HeldDraft {
  text: string;
  mode: "form" | "raw";
}
const VARIANTS: Record<RetentionVariant, string> = {
  "0": "today — draft dies on switch",
  A: "draft stays, list marks it",
  B: "draft stays, the switch speaks",
};

export function useRetention() {
  const search = useSearch({ strict: false }) as { variant?: string };
  const variant: RetentionVariant =
    search.variant === "A" || search.variant === "B" ? search.variant : "0";
  const [held, setHeld] = useState<ReadonlyMap<string, HeldDraft>>(() => new Map());
  /** B only: the member the person just walked away from with unsaved text. */
  const [left, setLeft] = useState<string | null>(null);
  const hold = useCallback((key: string, draft: HeldDraft | null) => {
    setHeld((previous) => {
      if (!draft && !previous.has(key)) return previous;
      if (draft && previous.get(key)?.text === draft.text && previous.get(key)?.mode === draft.mode)
        return previous;
      const next = new Map(previous);
      if (draft) next.set(key, draft);
      else next.delete(key);
      return next;
    });
  }, []);
  const active = variant !== "0";
  return {
    variant,
    held: active ? held : (new Map() as ReadonlyMap<string, HeldDraft>),
    hold: active ? hold : () => {},
    left: variant === "B" && left && held.has(left) ? left : null,
    /** Call on every member switch with the key being left. */
    leaving: (key: string | null) => setLeft(key && held.has(key) ? key : null),
    dismiss: () => setLeft(null),
    discard: (key: string) => (hold(key, null), setLeft(null)),
  };
}

/** B's sentence: what was left, and the two exits. */
export function LeftBehindLine({
  label,
  onBack,
  onDiscard,
}: {
  label: string;
  onBack: () => void;
  onDiscard: () => void;
}) {
  return (
    <div role="status" data-prototype="left-behind" className="flex items-center gap-2 px-3 py-1">
      <OutcomeLine
        kind="advisory"
        label="unsaved text kept"
        says={`on ${label}; nothing was saved or discarded`}
      />
      <Press tone="quiet" size="caption" onClick={onBack}>
        go back
      </Press>
      <Press tone="quiet" size="caption" onClick={onDiscard}>
        discard it
      </Press>
    </div>
  );
}

/** The alien switcher pill: bottom-centre, constant width, arrows cycle outside inputs. */
export function PrototypeSwitcher({ current }: { current: RetentionVariant }) {
  const navigate = useNavigate();
  const keys = Object.keys(VARIANTS) as RetentionVariant[];
  const go = (step: number) => {
    const next = keys[(keys.indexOf(current) + step + keys.length) % keys.length]!;
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({ ...previous, variant: next }),
      replace: true,
    });
  };
  return (
    <div
      data-prototype="switcher"
      style={{
        position: "fixed",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        width: 360,
        zIndex: 9999,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 12px",
        borderRadius: 999,
        background: "#ff2e93",
        color: "#fff",
        font: "600 13px system-ui",
      }}
    >
      <button
        type="button"
        aria-label="previous variant"
        onClick={() => go(-1)}
        style={{ color: "inherit" }}
      >
        ←
      </button>
      <span>
        PROTOTYPE {current} — {VARIANTS[current]}
      </span>
      <button
        type="button"
        aria-label="next variant"
        onClick={() => go(1)}
        style={{ color: "inherit" }}
      >
        →
      </button>
    </div>
  );
}
