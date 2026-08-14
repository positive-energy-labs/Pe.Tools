/** PROTOTYPE — floating variant switcher for /takeoff?variant=. Not part of the design under
 *  evaluation; hidden in production builds. */
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export interface VariantDef {
  key: string;
  name: string;
}

export function VariantSwitcher({ variants, current }: { variants: VariantDef[]; current: string }) {
  const navigate = useNavigate();
  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  const go = (delta: number) => {
    const next = variants[(idx + delta + variants.length) % variants.length]!;
    void navigate({ to: "/takeoff", search: { variant: next.key }, replace: true });
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
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-foreground/20 bg-foreground text-background shadow-lg">
      <button
        type="button"
        className="px-3 py-1.5 text-sm hover:opacity-70"
        onClick={() => go(-1)}
        aria-label="previous variant"
      >
        ←
      </button>
      <span className="tele min-w-44 text-center">
        {variants[idx]!.key} — {variants[idx]!.name}
      </span>
      <button
        type="button"
        className="px-3 py-1.5 text-sm hover:opacity-70"
        onClick={() => go(1)}
        aria-label="next variant"
      >
        →
      </button>
    </div>
  );
}
