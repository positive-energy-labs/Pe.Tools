/**
 * The help page (Alt+/). The layout is the data: the body measures the rendered panes, reads every
 * hotkey registration back from TanStack, and joins them by `meta.region`. Manifest chords (no
 * region) sit in a band above the chart; pane and widget keys hang off their region with a leader;
 * the route's `docs` prose renders below. Nothing here is a second list of keys.
 *
 * ponytail: `useHotkeyRegistrations()` returns a fresh snapshot per read, so a component that both
 * registers and reads re-renders forever. The body registers nothing and mounts only while open.
 */
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  useHotkeyRegistrations,
  useHotkeys,
  type UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";
import { Keyboard } from "lucide-react";

import { Press } from "#/components/lang/press";
import { readKeyMeta, type KeyMeta } from "./keys";

interface Region {
  id: string;
  label: string;
  rect: DOMRect;
}

interface Bound extends KeyMeta {
  hotkey: string;
}

const CARD_W = 240;

const measureRegions = (): { regions: Region[]; frame: DOMRect } | null => {
  const els = [...document.querySelectorAll<HTMLElement>('[data-slot="pane"]')];
  if (els.length === 0) return null;
  const frame = els[0]!.closest<HTMLElement>("main, [role='region']")?.getBoundingClientRect() ?? {
    left: Math.min(...els.map((el) => el.getBoundingClientRect().left)),
    top: Math.min(...els.map((el) => el.getBoundingClientRect().top)),
    right: Math.max(...els.map((el) => el.getBoundingClientRect().right)),
    bottom: Math.max(...els.map((el) => el.getBoundingClientRect().bottom)),
  };
  const f = frame as DOMRect;
  return {
    frame: new DOMRect(f.left, f.top, f.right - f.left, f.bottom - f.top),
    regions: els.map((el, index) => ({
      id: el.dataset.paneId ?? `${el.dataset.kind ?? "pane"}-${index}`,
      label:
        el.querySelector('[data-slot="pane-header"] h2')?.textContent?.trim() ||
        el.dataset.paneId ||
        el.dataset.kind ||
        `pane ${index + 1}`,
      rect: el.getBoundingClientRect(),
    })),
  };
};

function Key({ mute, children }: { mute?: boolean; children: ReactNode }) {
  return (
    <kbd
      data-surface="recess"
      className={`face-mono t-small inline-flex min-w-7 shrink-0 items-center justify-center border px-1 py-0.5 ${
        mute ? "border-line text-ink-mute" : "border-line-2 text-ink"
      }`}
    >
      {children}
    </kbd>
  );
}

function Rows({ keys }: { keys: readonly Bound[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 t-small">
      {keys.map((k) => (
        <Fragment key={`${k.hotkey}:${k.name}`}>
          <dt>
            <Key mute={Boolean(k.refusal)}>{k.hotkey}</Key>
          </dt>
          <dd
            className={k.refusal ? "text-ink-mute" : "text-ink"}
            title={k.refusal ?? k.description}
          >
            {k.name}
            {k.refusal ? ` — refuses now: ${k.refusal}` : ""}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Chart({
  regions,
  frame,
  byRegion,
}: {
  regions: Region[];
  frame: DOMRect;
  byRegion: ReadonlyMap<string, Bound[]>;
}) {
  const mid = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const rect = mid.current?.getBoundingClientRect();
      if (rect) setSize({ w: rect.width, h: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const left = regions.filter(
    (r) => r.rect.left + r.rect.width / 2 <= frame.left + frame.width / 2,
  );
  const right = regions.filter((r) => !left.includes(r));

  return (
    <div ref={mid} className="relative min-h-0 flex-1">
      {size
        ? (() => {
            const mapW = Math.max(200, Math.min(size.w - 2 * (CARD_W + 64), 640));
            const mapH = Math.max(120, Math.min(size.h - 24, mapW * (frame.height / frame.width)));
            const mapX = (size.w - mapW) / 2;
            const mapY = (size.h - mapH) / 2;
            const sx = (x: number) => mapX + ((x - frame.left) / frame.width) * mapW;
            const sy = (y: number) => mapY + ((y - frame.top) / frame.height) * mapH;
            const cardY = (column: Region[], index: number) => {
              const spacing = Math.min(200, (size.h - 16) / Math.max(column.length, 1));
              return size.h / 2 - (column.length * spacing) / 2 + index * spacing;
            };
            const card = (r: Region, x: number, y: number) => (
              <div
                key={r.id}
                data-surface="page"
                className="absolute flex flex-col border border-line-2"
                style={{ width: CARD_W, left: x, top: y }}
              >
                <div className="t-small t-upper px-2.5 py-1.5 text-ink">{r.label} · keys</div>
                <div className="hairline-t px-2.5 py-2">
                  {byRegion.get(r.id)?.length ? (
                    <Rows keys={byRegion.get(r.id)!} />
                  ) : (
                    <span className="t-small text-ink-mute">
                      no keys while this region is focused
                    </span>
                  )}
                </div>
              </div>
            );
            const leader = (r: Region, fromX: number, y: number, into: number) => (
              <polyline
                key={r.id}
                points={`${fromX},${y} ${into},${sy(r.rect.top + r.rect.height / 2)} ${sx(r.rect.left + r.rect.width / 2)},${sy(r.rect.top + r.rect.height / 2)}`}
                fill="none"
                stroke="currentColor"
              />
            );
            return (
              <>
                <svg width={size.w} height={size.h} className="absolute inset-0 text-ink-mute">
                  {left.map((r, i) => leader(r, 24 + CARD_W, cardY(left, i) + 20, mapX - 24))}
                  {right.map((r, i) =>
                    leader(r, size.w - 24 - CARD_W, cardY(right, i) + 20, mapX + mapW + 24),
                  )}
                  <rect
                    x={mapX}
                    y={mapY}
                    width={mapW}
                    height={mapH}
                    fill="none"
                    stroke="currentColor"
                  />
                  {regions.map((r, i) => (
                    <g key={r.id}>
                      <rect
                        x={sx(r.rect.left) + 2}
                        y={sy(r.rect.top) + 2}
                        width={Math.max((r.rect.width / frame.width) * mapW - 4, 4)}
                        height={Math.max((r.rect.height / frame.height) * mapH - 4, 4)}
                        fill="none"
                        stroke="currentColor"
                      />
                      <text
                        x={sx(r.rect.left) + 8}
                        y={sy(r.rect.top) + 16}
                        fill="currentColor"
                        fontSize={10}
                      >
                        {i + 1} {r.label}
                      </text>
                    </g>
                  ))}
                </svg>
                {left.map((r, i) => card(r, 24, cardY(left, i)))}
                {right.map((r, i) => card(r, size.w - 24 - CARD_W, cardY(right, i)))}
              </>
            );
          })()
        : null}
    </div>
  );
}

function HelpBody({ docs, name }: { docs: ReactNode; name: string }) {
  const { hotkeys } = useHotkeyRegistrations();
  const layout = useMemo(measureRegions, []);
  const bound: Bound[] = hotkeys.flatMap((reg) => {
    const meta = readKeyMeta(reg.options.meta);
    return meta ? [{ ...meta, hotkey: reg.hotkey }] : [];
  });
  const band = bound.filter((k) => !k.region);
  const byRegion = new Map<string, Bound[]>();
  for (const k of bound)
    if (k.region) byRegion.set(k.region, [...(byRegion.get(k.region) ?? []), k]);

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex shrink-0 items-baseline gap-6 px-8 pt-6 pb-3">
        <span className="t-title text-ink">{name}</span>
        {band.length ? (
          <Rows keys={band} />
        ) : (
          <span className="t-small text-ink-mute">this route declares no chords</span>
        )}
      </div>
      {layout ? (
        <Chart regions={layout.regions} frame={layout.frame} byRegion={byRegion} />
      ) : (
        <div className="flex flex-1 items-center justify-center t-small text-ink-mute">
          this route draws no panes to explain
        </div>
      )}
      {docs ? <div className="shrink-0 overflow-y-auto px-8 pt-3 pb-8">{docs}</div> : null}
    </div>
  );
}

export function RouteHelpButton({ docs, name }: { docs?: ReactNode; name: string }) {
  const [open, setOpen] = useState(false);
  const help = useMemo(
    (): UseHotkeyDefinition[] => [
      { hotkey: "Alt+/", callback: () => setOpen(true), options: { ignoreInputs: true } },
    ],
    [],
  );
  useHotkeys(help);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={<Press tone="quiet" size="icon" />}
        title="how this route works — its regions and every key bound right now (Alt+/)"
      >
        <Keyboard />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-modal outline-none">
          <div data-surface="page" className="absolute inset-0" onClick={() => setOpen(false)} />
          <HelpBody docs={docs} name={name} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
