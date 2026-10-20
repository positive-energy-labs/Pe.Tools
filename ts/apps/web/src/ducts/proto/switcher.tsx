/** THROWAWAY (protoui round 1): the variant pill. Dev builds only. */
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const VARIANTS = [
  { id: "E1", name: "Losses sidebar" },
  { id: "E2", name: "Tree sidebar" },
  { id: "B", name: "Profiler" },
  { id: "C", name: "Variant C" },
  { id: "D", name: "Variant D" },
] as const;
export type VariantId = (typeof VARIANTS)[number]["id"];

export const asVariant = (value: unknown): VariantId | undefined =>
  VARIANTS.find((v) => v.id === value)?.id;

export function PrototypeSwitcher({ variant }: { variant: VariantId }) {
  const navigate = useNavigate();
  const index = VARIANTS.findIndex((v) => v.id === variant);
  const go = (step: number) => {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length]!;
    void navigate({
      to: ".",
      search: ((previous: Record<string, unknown>) => ({ ...previous, variant: next.id })) as never,
      replace: true,
    });
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.matches("input, textarea, select") || el.isContentEditable)) return;
      if (event.key === "ArrowLeft") go(-1);
      else if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (!import.meta.env.DEV) return null;
  const button = {
    all: "unset",
    cursor: "pointer",
    padding: "0 10px",
    font: "inherit",
  } as const;
  return (
    <div
      style={{
        position: "fixed",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        width: 320,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 4px",
        border: "2px dashed magenta",
        borderRadius: 999,
        background: "#1a001a",
        color: "magenta",
        font: "600 13px ui-monospace, monospace",
      }}
    >
      <button type="button" aria-label="previous variant" style={button} onClick={() => go(-1)}>
        ←
      </button>
      <span>
        {VARIANTS[index]!.id} — {VARIANTS[index]!.name}
      </span>
      <button type="button" aria-label="next variant" style={button} onClick={() => go(1)}>
        →
      </button>
    </div>
  );
}
