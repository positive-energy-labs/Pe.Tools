/**
 * The help page (Alt+/). The layout is the data: the body measures the visible panes, reads every
 * hotkey registration back from TanStack, and joins them to a pane by `meta.scope`. Chords bound
 * above any pane sit in a band over the chart; a pane's keys hang off it with a leader; the route's
 * `docs` prose renders below. Nothing here is a second list of keys.
 *
 * Panes and registrations are read once as the body mounts (it exists only while open), so the page
 * is a still picture of the route, not a subscriber that re-renders on every registration.
 */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { Kbd } from "#/components/lang/kbd";
import { Button } from "@pe/kit/lang/button";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { startFeedback } from "#/components/feedback-picker";
import { MachineHelpTrigger } from "#/machine/navigation";
import { readKeyMeta, readRegistrations, useScopeKeys, type KeyMeta } from "@pe/kit/keys";

interface Region {
  id: string;
  label: string;
  rect: DOMRect;
}

interface Bound extends KeyMeta {
  hotkey: string;
}

const CARD_W = 240;
/** The chord that opens this page; the page does not list it among the keys it explains. */
const HELP_CHORD = { hotkey: "Alt+/", label: "How this route works" } as const;
const CARD_GAP = 12;
/** Below this the chart keeps one column of cards instead of two. */
const TWO_COLUMNS_W = 800;

/**
 * The panes the user can see now. A pane under `<Activity mode="hidden">` stays mounted with
 * `display: none`, so it measures 0x0 at the origin; `checkVisibility()` is false for it and for
 * anything inside a hidden subtree, which is exactly what "drawn" means.
 */
const measureRegions = (): Region[] =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="pane"]')]
    .filter((el) => el.checkVisibility())
    .map((el, index) => ({
      id: el.dataset.paneId ?? `${el.dataset.kind ?? "pane"}-${index}`,
      label:
        el.querySelector('[data-slot="pane-title"]')?.textContent?.trim() ||
        el.querySelector('[data-slot="pane-header"] h2')?.textContent?.trim() ||
        el.getAttribute("aria-label") ||
        el.dataset.paneId ||
        el.dataset.kind ||
        `pane ${index + 1}`,
      rect: el.getBoundingClientRect(),
    }));

const unionOf = (regions: readonly Region[]) => {
  const left = Math.min(...regions.map((r) => r.rect.left));
  const top = Math.min(...regions.map((r) => r.rect.top));
  return new DOMRect(
    left,
    top,
    Math.max(...regions.map((r) => r.rect.right)) - left,
    Math.max(...regions.map((r) => r.rect.bottom)) - top,
  );
};

/** `flow` wraps the pairs across the line (the route band); default is one column (a card). */
function Rows({ keys, flow = false }: { keys: readonly Bound[]; flow?: boolean }) {
  return (
    <dl
      className={
        flow
          ? "flex min-w-0 flex-wrap gap-x-5 gap-y-1 t-small"
          : "grid grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-1 t-small"
      }
    >
      {keys.map((k) => (
        <div
          key={`${k.hotkey}:${k.name}`}
          className={flow ? "flex items-center gap-2.5" : "contents"}
        >
          <dt>
            <Kbd mute={Boolean(k.refusal)} hotkey={k.hotkey} />
          </dt>
          <dd
            className={k.refusal ? "text-ink-mute" : "text-ink"}
            title={k.refusal ?? k.description}
          >
            {k.name}
            {k.refusal ? ` — refuses now: ${k.refusal}` : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Where a card's body ends; `Rows` draws one 22 px line per key under a 30 px head. */
const cardHeight = (keys: number) => 30 + 17 + keys * 22;

function Chart({
  regions,
  byRegion,
}: {
  regions: Region[];
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
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (mid.current) observer?.observe(mid.current);
    return () => observer?.disconnect();
  }, []);

  const frame = unionOf(regions);
  const twoColumns = size !== null && size.w >= TWO_COLUMNS_W;
  const sideOf = (region: Region) =>
    twoColumns && region.rect.left + region.rect.width / 2 <= frame.left + frame.width / 2
      ? "left"
      : "right";
  // The chart is never shorter than its tallest column of cards; the page scrolls instead.
  const need = Math.max(
    ...(["left", "right"] as const).map((side) =>
      regions
        .filter((region) => sideOf(region) === side)
        .reduce((sum, region) => {
          const keys = byRegion.get(region.id)?.length ?? 0;
          return keys ? sum + cardHeight(keys) + CARD_GAP : sum;
        }, 8),
    ),
  );
  const view = (() => {
    if (!size) return null;
    // One scale for both axes, so a pane keeps its shape on the chart.
    const room = {
      w: size.w - (twoColumns ? 2 : 1) * (CARD_W + 72) - (twoColumns ? 0 : 24),
      h: size.h - 24,
    };
    const k = Math.min(
      Math.max(room.w, 160) / frame.width,
      room.h / frame.height,
      720 / frame.width,
    );
    const w = frame.width * k;
    const h = frame.height * k;
    const x = twoColumns ? (size.w - w) / 2 : 24;
    const y = (size.h - h) / 2;
    return {
      w,
      h,
      sx: (v: number) => x + (v - frame.left) * k,
      sy: (v: number) => y + (v - frame.top) * k,
    };
  })();

  // A region with keys gets a card on the side it sits on; a keyless region is outlined and named,
  // and says nothing more. Cards stack in anchor order so leaders never cross.
  const cards = view
    ? (["left", "right"] as const).flatMap((side) => {
        let floor = 8;
        const placed = regions
          .flatMap((region, index) => {
            const keys = byRegion.get(region.id) ?? [];
            const left = side === "left";
            if (keys.length === 0 || sideOf(region) !== side) return [];
            return [
              {
                region,
                keys,
                n: index + 1,
                ax: view.sx(left ? region.rect.left : region.rect.right),
                ay: view.sy(region.rect.top + region.rect.height / 2),
              },
            ];
          })
          .sort((p, q) => p.ay - q.ay)
          .map((card) => {
            const top = Math.max(floor, card.ay - 16);
            floor = top + cardHeight(card.keys.length) + CARD_GAP;
            return { ...card, side, top };
          });
        const overflow = Math.max(0, floor - CARD_GAP - (size!.h - 8));
        return placed.map((card) => ({ ...card, top: Math.max(8, card.top - overflow) }));
      })
    : [];

  return (
    <div ref={mid} className="relative min-w-0 flex-1" style={{ minHeight: Math.max(need, 280) }}>
      {size && view ? (
        <>
          <svg width={size.w} height={size.h} className="absolute inset-0 text-ink-mute">
            {regions.map((r, i) => (
              <g key={`${r.id}:${i}`}>
                <rect
                  x={view.sx(r.rect.left)}
                  y={view.sy(r.rect.top)}
                  width={Math.max(view.sx(r.rect.right) - view.sx(r.rect.left), 4)}
                  height={Math.max(view.sy(r.rect.bottom) - view.sy(r.rect.top), 4)}
                  fill="none"
                  stroke="currentColor"
                />
                <text
                  x={view.sx(r.rect.left) + 6}
                  y={view.sy(r.rect.top) + 14}
                  fill="currentColor"
                  fontSize={10}
                >
                  {i + 1} {r.label}
                </text>
              </g>
            ))}
            {cards.map((c) => (
              <g key={c.region.id + c.n}>
                <line
                  x1={c.side === "left" ? 24 + CARD_W : size.w - 24 - CARD_W}
                  y1={c.top + 16}
                  x2={c.ax}
                  y2={c.ay}
                  stroke="currentColor"
                />
                <circle cx={c.ax} cy={c.ay} r={2.5} fill="currentColor" />
              </g>
            ))}
          </svg>
          {cards.map((c) => (
            <div
              key={c.region.id + c.n}
              data-surface="page"
              className="absolute flex flex-col border border-line-2"
              style={{
                width: CARD_W,
                left: c.side === "left" ? 24 : size.w - 24 - CARD_W,
                top: c.top,
              }}
            >
              <div className="t-small t-upper truncate px-2.5 py-1.5 text-ink">
                {c.n} {c.region.label} · keys
              </div>
              <div className="hairline-t px-2.5 py-2">
                <Rows keys={c.keys} />
              </div>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function HelpBody({
  docs,
  name,
  utilities,
  close,
}: {
  docs: ReactNode;
  name: string;
  utilities?: boolean;
  close: () => void;
}) {
  const hotkeys = useMemo(readRegistrations, []);
  const regions = useMemo(measureRegions, []);
  // A chord bound at several nodes reads once, at the shallowest.
  const bound = new Map<string, Bound>();
  for (const reg of hotkeys) {
    const meta = readKeyMeta(reg.options.meta);
    if (!meta || (reg.hotkey === HELP_CHORD.hotkey && meta.name === HELP_CHORD.label)) continue;
    const key = `${reg.hotkey}:${meta.name}`;
    if ((bound.get(key)?.depth ?? Infinity) > meta.depth)
      bound.set(key, { ...meta, hotkey: reg.hotkey });
  }
  // The chart's cards are the visible panes; every other scope node's keys read as the route's.
  const drawn = new Set(regions.map((region) => region.id));
  const band: Bound[] = [];
  const byRegion = new Map<string, Bound[]>();
  for (const k of bound.values())
    if (drawn.has(k.scope)) byRegion.set(k.scope, [...(byRegion.get(k.scope) ?? []), k]);
    else band.push(k);

  return (
    <div className="absolute inset-0 flex flex-col overflow-y-auto">
      <div className="flex shrink-0 items-baseline gap-6 px-8 pt-6 pb-3">
        <span className="t-title text-ink">{name}</span>
        {band.length ? (
          <Rows keys={band} flow />
        ) : (
          <span className="t-small text-ink-mute">this route declares no chords</span>
        )}
      </div>
      {regions.length ? (
        <Chart regions={regions} byRegion={byRegion} />
      ) : (
        <div className="flex flex-1 items-center justify-center t-small text-ink-mute">
          this route draws no panes to explain
        </div>
      )}
      {docs ? <div className="shrink-0 overflow-y-auto px-8 pt-3 pb-8 t-prose">{docs}</div> : null}
      {utilities ? (
        <div className="hairline-t flex shrink-0 items-center gap-3 px-8 py-3">
          <Button
            label="Send feedback"
            onClick={() => {
              close();
              startFeedback();
            }}
          >
            Send feedback
          </Button>
          <MachineHelpTrigger onOpen={close} />
        </div>
      ) : null}
    </div>
  );
}

export function RouteHelpButton({
  docs,
  name,
  utilities = false,
}: {
  docs?: ReactNode;
  name: string;
  utilities?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Focus the page itself, not its first tabbable (a footer button) that would scroll it to the end.
  const popup = useRef<HTMLDivElement>(null);
  // Bound on the document, not the pane the button renders in: the chord opens help with focus
  // anywhere, the composer's draft included.
  useScopeKeys(
    [
      {
        hotkey: HELP_CHORD.hotkey,
        label: HELP_CHORD.label,
        callback: () => setOpen(true),
        options: { ignoreInputs: false },
      },
    ],
    document.documentElement,
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={
          <HotkeyCommand
            bind={false}
            label={HELP_CHORD.label}
            word="Tutorial"
            hotkey={HELP_CHORD.hotkey}
            reason="how this route works — its regions and every key bound right now (Alt+/)"
            invoke={() => setOpen(true)}
          />
        }
      />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          ref={popup}
          initialFocus={popup}
          className="fixed inset-0 z-modal outline-none"
        >
          <div data-surface="page" className="absolute inset-0" onClick={() => setOpen(false)} />
          <HelpBody docs={docs} name={name} utilities={utilities} close={() => setOpen(false)} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
