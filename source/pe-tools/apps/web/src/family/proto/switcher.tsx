/**
 * PROTOTYPE — floating variant switcher for the clean-room /family exploration.
 * Fixed bottom-centre pill, deliberately alien to the design system so it never reads as part
 * of the page under review. Arrows + ←/→ cycle; URL is the state. Dev-only.
 */
import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

export interface VariantMeta {
  key: string;
  name: string;
}

export function ProtoSwitcher({
  variants,
  current,
}: {
  variants: VariantMeta[];
  current: string;
}) {
  const navigate = useNavigate();
  const index = Math.max(
    0,
    variants.findIndex((entry) => entry.key === current),
  );
  const go = (step: number) => {
    const next = variants[(index + step + variants.length) % variants.length]!;
    void navigate({
      to: "/family",
      search: (prev: Record<string, unknown>) => ({ ...prev, variant: next.key }),
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,select,textarea,[contenteditable=true]")) return;
      go(event.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;

  const meta = variants[index]!;
  return (
    <div className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-zinc-900 px-3 py-1.5 font-mono text-[12px] text-zinc-100 shadow-lg">
      <button type="button" onClick={() => go(-1)} className="px-1 hover:text-white">
        ←
      </button>
      <span className="tracking-wide">
        {meta.key} — {meta.name}
      </span>
      <button type="button" onClick={() => go(1)} className="px-1 hover:text-white">
        →
      </button>
    </div>
  );
}
