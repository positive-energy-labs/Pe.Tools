/**
 * PROTOTYPE CHROME — the floating variant switcher (throwaway with the round).
 * Deliberately alien styling (dark pill, no design-lang tokens) so it cannot be
 * mistaken for part of the design under review.
 */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export interface VariantDef {
  key: string;
  name: string;
}

export function ProtoSwitcher({ variants, current }: { variants: VariantDef[]; current: string }) {
  const navigate = useNavigate();
  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  const go = (delta: number) => {
    const next = variants[(idx + delta + variants.length) % variants.length];
    void navigate({
      to: ".",
      search: (prev: Record<string, unknown>) => ({ ...prev, variant: next.key }),
      replace: true,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "#1a1a2e",
        color: "#e6e6fa",
        borderRadius: 999,
        padding: "6px 14px",
        fontFamily: "monospace",
        fontSize: 12,
        boxShadow: "0 4px 16px rgba(0,0,0,.4)",
      }}
    >
      <button style={{ cursor: "pointer" }} onClick={() => go(-1)}>
        ←
      </button>
      <span>
        {variants[idx]?.key} — {variants[idx]?.name} ({idx + 1}/{variants.length})
      </span>
      <button style={{ cursor: "pointer" }} onClick={() => go(1)}>
        →
      </button>
    </div>
  );
}
