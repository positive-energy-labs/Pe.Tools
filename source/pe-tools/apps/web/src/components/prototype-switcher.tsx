/**
 * PROTOTYPE SWITCHER — the protoui lineup bar. Fixed bottom-centre, constant width, visually alien
 * to the page on purpose (it is not the design). Arrows and ← → keys cycle `?variant=` through the
 * router so a URL is shareable and reload-stable. Gated out of production builds.
 */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export interface PrototypeVariant {
  key: string;
  label: string;
}

export function PrototypeSwitcher({
  variants,
  current,
}: {
  variants: readonly PrototypeVariant[];
  current: string;
}) {
  const navigate = useNavigate();
  const index = Math.max(
    0,
    variants.findIndex((variant) => variant.key === current),
  );
  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length]!;
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({ ...previous, variant: next.key }),
      replace: true,
    } as never);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (import.meta.env.PROD) return null;
  const variant = variants[index]!;
  return (
    <div
      role="navigation"
      aria-label="prototype variant switcher"
      className="fixed bottom-3 left-1/2 z-50 flex w-[28rem] -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[12px] shadow-lg"
      style={{ background: "#ff2fa0", color: "#111", border: "2px dashed #111" }}
    >
      <button type="button" onClick={() => go(-1)} aria-label="previous variant" className="px-1">
        ←
      </button>
      <span className="min-w-0 flex-1 text-center">
        <b>{variant.key}</b> — {variant.label} ({index + 1}/{variants.length})
      </span>
      <button type="button" onClick={() => go(1)} aria-label="next variant" className="px-1">
        →
      </button>
    </div>
  );
}
