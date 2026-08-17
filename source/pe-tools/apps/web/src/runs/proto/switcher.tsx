// Variant switcher for the /runs prototypes. Deliberately styled UNLIKE the design system so it
// never reads as part of the page under review (find-the-product rule). Arrow keys or click.
import { useEffect } from "react";

export function VariantSwitcher(props: {
  variants: string[];
  active: string;
  onSelect: (variant: string) => void;
}) {
  const { variants, active, onSelect } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && /input|textarea|select/i.test(target.tagName)) return;
      const index = variants.indexOf(active);
      const next =
        event.key === "ArrowRight"
          ? variants[(index + 1) % variants.length]!
          : variants[(index - 1 + variants.length) % variants.length]!;
      onSelect(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variants, active, onSelect]);

  if (!import.meta.env.DEV) return null;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 60,
        display: "flex",
        gap: 4,
        padding: "6px 8px",
        background: "#1c1917",
        color: "#e7e5e4",
        borderRadius: 999,
        fontFamily: "monospace",
        fontSize: 12,
        boxShadow: "0 2px 10px rgba(0,0,0,.35)",
      }}
    >
      {variants.map((variant) => (
        <button
          key={variant}
          type="button"
          onClick={() => onSelect(variant)}
          style={{
            padding: "2px 10px",
            borderRadius: 999,
            border: "none",
            cursor: "pointer",
            background: variant === active ? "#f59e0b" : "transparent",
            color: variant === active ? "#1c1917" : "#e7e5e4",
          }}
        >
          {variant}
        </button>
      ))}
    </div>
  );
}
