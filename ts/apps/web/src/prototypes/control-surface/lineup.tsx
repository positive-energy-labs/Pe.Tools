import { TooltipHint } from "@pe/kit/lang/tooltip";
/**
 * THROWAWAY protoui lineup (2026-10-13): the Pe.Tools control surface — tray, inbox, Work,
 * patch bay, notifications. `/design-system/control-surface?variant=<id>`; every variant sits on the same fake desktop
 * at its own declared size, docked bottom-right above a fake taskbar. Variants are fixture-only
 * (open/seeds, chat/seeds). Delete the folder when the round is ruled.
 */
import { useEffect, type ComponentType } from "react";
import { useNavigate } from "@tanstack/react-router";

export interface VariantMeta {
  id: string;
  label: string;
  /** Panel size in CSS px; the desktop frame docks it bottom-right, padded from the edge. */
  width: number;
  height: number;
  /** "tray" docks one panel; "toasts" lets the variant place its own stack of windows. */
  kind?: "tray" | "toasts";
}

type VariantModule = { meta: VariantMeta; default: ComponentType };

const MODULES = import.meta.glob<VariantModule>("./variant-*.tsx", { eager: true });
const VARIANTS = Object.values(MODULES)
  .filter((m) => m.meta && m.default)
  .sort((a, b) => a.meta.id.localeCompare(b.meta.id, undefined, { numeric: true }));

export function Lineup({ variant }: { variant: string }) {
  const navigate = useNavigate();
  const index = Math.max(
    0,
    VARIANTS.findIndex((v) => v.meta.id === variant),
  );
  const current = VARIANTS[index];
  const go = (step: number) => {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length];
    if (next)
      void navigate({ to: "/design-system/control-surface", search: { variant: next.meta.id } });
    // ponytail: numeric ids round-trip as numbers in the URL; the route String()s them back.
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable=true], [contenteditable='']")) return;
      if (e.key === "ArrowLeft" && e.altKey) go(-1);
      if (e.key === "ArrowRight" && e.altKey) go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!current) return <div className="p-6 font-mono">No variants landed yet.</div>;
  const { meta, default: Variant } = current;
  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        background: "radial-gradient(120% 90% at 20% 10%, #2b3a4a 0%, #16202b 45%, #0b0f14 100%)",
      }}
    >
      {meta.kind === "toasts" ? (
        <div className="absolute inset-x-0 top-0" style={{ bottom: 48 }}>
          <Variant />
        </div>
      ) : (
        <div
          className="absolute overflow-hidden rounded-[10px] shadow-[0_18px_60px_rgba(0,0,0,.55)] ring-1 ring-white/10"
          style={{ right: 12, bottom: 48 + 12, width: meta.width, height: meta.height }}
        >
          <Variant />
        </div>
      )}
      {/* fake taskbar */}
      <div className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-end gap-4 bg-[#1b1f3a]/95 px-4 text-[13px] text-white/80">
        <span>^</span>
        <span className="grid size-6 place-content-center rounded bg-white/15 text-[11px] font-bold">
          Pe
        </span>
        <span>10:53 AM</span>
      </div>
      {/* protoui switcher: alien on purpose */}
      <div
        className="fixed left-1/2 z-[2147483646] flex w-[440px] -translate-x-1/2 items-center justify-between rounded-full border-2 border-dashed border-fuchsia-400 bg-yellow-300 px-2 py-1 font-mono text-[13px] text-black shadow-lg"
        style={{ bottom: 56 + 4 }}
      >
        <button type="button" className="px-3 text-lg" onClick={() => go(-1)} aria-label="previous">
          ←
        </button>
        <TooltipHint content="Alt+← / Alt+→">
          <span className="truncate">
            {meta.id} — {meta.label} ({meta.width}×{meta.height})
          </span>
        </TooltipHint>
        <button type="button" className="px-3 text-lg" onClick={() => go(1)} aria-label="next">
          →
        </button>
      </div>
    </div>
  );
}
