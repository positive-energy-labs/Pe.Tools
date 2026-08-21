/**
 * PROTOTYPE-ONLY variant switcher — deliberately alien chrome (design-lang §5
 * exemption) so it cannot read as part of the design under review.
 */
import { useEffect } from "react";

export function VariantSwitcher({
  variants,
  current,
  onSelect,
}: {
  variants: { key: string; name: string }[];
  current: string;
  onSelect: (key: string) => void;
}) {
  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (delta: number) => {
    const next = variants[(idx + delta + variants.length) % variants.length];
    if (next) onSelect(next.key);
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
        gap: 12,
        background: "#1a1a2e",
        color: "#e8e8f0",
        borderRadius: 999,
        padding: "8px 16px",
        fontFamily: "ui-monospace, monospace",
        fontSize: 12,
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
      }}
    >
      <button
        type="button"
        onClick={() => go(-1)}
        style={{
          cursor: "pointer",
          background: "none",
          border: "none",
          color: "inherit",
          fontSize: 14,
        }}
      >
        ←
      </button>
      <span>
        PROTO {current.toUpperCase()} — {variants[idx]?.name ?? "?"} ({idx + 1}/{variants.length})
      </span>
      <button
        type="button"
        onClick={() => go(1)}
        style={{
          cursor: "pointer",
          background: "none",
          border: "none",
          color: "inherit",
          fontSize: 14,
        }}
      >
        →
      </button>
    </div>
  );
}
