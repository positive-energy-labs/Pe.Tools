// THROWAWAY — /runs feedback-loop round 1. The floating variant switcher, deliberately styled
// UNLIKE the design system so it never reads as part of the page under review (find-the-product
// rule; idiom lifted from the retired round-1 switcher at a26916e). ←/→ cycles; the deck
// suppresses that while open (it captures the arrows for prev/next).
import { useEffect } from "react";

import { fb, type FbVariant, useFb } from "./staging";

const OPTIONS: (FbVariant | null)[] = [null, "tray", "deck", "ledger"];
const label = (v: FbVariant | null) => v ?? "off";

export function FbSwitcher() {
  const { variant, deckOpen } = useFb();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (fb.get().deckOpen) return; // deck owns the arrows while open
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      const index = OPTIONS.indexOf(fb.get().variant);
      const next =
        event.key === "ArrowRight"
          ? OPTIONS[(index + 1) % OPTIONS.length]!
          : OPTIONS[(index - 1 + OPTIONS.length) % OPTIONS.length]!;
      fb.setVariant(next ?? null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!import.meta.env.DEV || deckOpen) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 60,
        display: "flex",
        gap: 4,
        alignItems: "center",
        padding: "6px 8px",
        background: "#1c1917",
        color: "#e7e5e4",
        borderRadius: 999,
        fontFamily: "monospace",
        fontSize: 12,
        boxShadow: "0 2px 10px rgba(0,0,0,.35)",
      }}
    >
      <span style={{ opacity: 0.6, paddingLeft: 4 }}>fb</span>
      {OPTIONS.map((v) => (
        <button
          key={label(v)}
          type="button"
          onClick={() => fb.setVariant(v)}
          style={{
            padding: "2px 10px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            background: v === variant ? "#f59e0b" : "transparent",
            color: v === variant ? "#1c1917" : "#e7e5e4",
          }}
        >
          {label(v)}
        </button>
      ))}
    </div>
  );
}
