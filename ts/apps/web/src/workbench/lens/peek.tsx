import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { annotation } from "#/components/anatomy";
import { formatTime, type Turn } from "./moments";

/** Px above and below a tick that still count as on it. */
const HIT = 6;
/** Grace for the pointer to cross from the lane onto the card (and back) without closing. */
const LINGER = 300;
/** Px the whole stack, ghosts included, keeps from the pane head and the composer. */
const EDGE = 4;

/** Which way the last change moved, so the new card enters from that side. */
type Enter = "open" | "up" | "down";

/**
 * The turn peek: hover a turn's tick on the rail and its card opens beside the lane, a funnel
 * drawn from the card to the turn's band. While open, the peek holds only its own cards (the active
 * one and its ghosts) plus a gutter of grace; leaving that box in any direction closes it. The card
 * always centres on its turn's tick; past its edge the pointer scrubs the rail 1:1, so the card
 * moves exactly as far as the pointer at any speed. Any click on the card, a ghost, a band or a tick
 * goes to that turn. It never opens mid-drag, so selecting transcript text never meets it.
 */
export function TurnPeek({
  turns,
  laneRef,
  dialRef,
  goTo,
}: {
  turns: readonly Turn[];
  laneRef: RefObject<HTMLDivElement | null>;
  dialRef: RefObject<HTMLDivElement | null>;
  goTo: (key: string) => void;
}) {
  const [peek, setPeek] = useState<{ index: number; enter: Enter } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const funnelRef = useRef<SVGPolygonElement>(null);
  const closer = useRef<number>(undefined);
  /** The active card's placed box, lane-relative: inside it the pointer reads, outside it scrubs. */
  const box = useRef({ top: 0, bottom: 0 });
  /** A scrub past one edge: the pointer's offset from the active tick when it crossed, so the
   *  card then moves 1:1 with the pointer along the rail. Cleared back inside the card. */
  const scrub = useRef<{ dir: 1 | -1; offset: number } | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const linger = () => window.clearTimeout(closer.current);
  // The close asks where the pointer IS when it fires, not which event came last: React's enter
  // runs on `pointerout`, before the rail's native `pointerleave`, so an enter cannot cancel it.
  const close = () => {
    linger();
    closer.current = window.setTimeout(() => {
      const held = [cardRef.current, funnelRef.current, dialRef.current].some((el) =>
        el?.matches(":hover"),
      );
      if (!held) setPeek(null);
    }, LINGER);
  };

  // The lane: a tick under the pointer opens its turn; a click goes to the turn it lands on.
  useEffect(() => {
    const dial = dialRef.current;
    const lane = laneRef.current;
    if (!dial || !lane) return;
    const tickAt = (clientY: number) => {
      let best: { index: number; y: number; d: number } | null = null;
      for (const tick of dial.querySelectorAll<HTMLElement>('[data-annotation="dial-tick"]')) {
        if (tick.hidden) continue;
        const y = tick.getBoundingClientRect().top;
        const d = Math.abs(clientY - y);
        if (d <= HIT && (!best || d < best.d)) best = { index: Number(tick.dataset.index), y, d };
      }
      return best;
    };
    // N7: a turn's whole band answers the pointer, not only the few pixels around its tick; hover
    // previews exactly what a click there would open.
    const turnAt = (event: MouseEvent) => {
      const hit = tickAt(event.clientY);
      if (hit) return hit.index;
      const band = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-annotation="dial-band"]',
      );
      return band ? Number(band.dataset.index) : undefined;
    };
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      linger();
      const index = turnAt(event);
      if (index === undefined) return;
      scrub.current = null;
      setPeek((current) =>
        current?.index === index
          ? current
          : { index, enter: !current ? "open" : index > current.index ? "down" : "up" },
      );
    };
    // A press goes to the turn at its height: the tick it lands on, else the band spanning that y.
    // Read by y, not by target: the rail captures the pointer for a scrub, so the click lands on
    // the dial itself, also for a press that began on the funnel.
    const bandAt = (clientY: number) => {
      for (const band of dial.querySelectorAll<HTMLElement>('[data-annotation="dial-band"]')) {
        const r = band.getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) return Number(band.dataset.index);
      }
      return undefined;
    };
    const onClick = (event: MouseEvent) => {
      const index = tickAt(event.clientY)?.index ?? bandAt(event.clientY);
      const turn = index === undefined ? undefined : turnsRef.current[index];
      if (turn) goTo(turn.first);
    };
    dial.addEventListener("pointermove", onMove);
    dial.addEventListener("pointerleave", close);
    dial.addEventListener("click", onClick);
    return () => {
      dial.removeEventListener("pointermove", onMove);
      dial.removeEventListener("pointerleave", close);
      dial.removeEventListener("click", onClick);
    };
  }, [dialRef, laneRef, goTo]);

  // Fine control: while the pointer rests on the peek or the rail, ↑/↓ step one turn. Captured
  // ahead of the page so they neither scroll the transcript nor move the composer's caret.
  const open = peek !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const dir = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (!dir || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (![cardRef.current, dialRef.current].some((el) => el?.matches(":hover"))) return;
      event.preventDefault();
      event.stopPropagation();
      scrub.current = null;
      setPeek((current) => {
        if (!current) return current;
        const index = Math.max(0, Math.min(turnsRef.current.length - 1, current.index + dir));
        return index === current.index ? current : { index, enter: dir > 0 ? "down" : "up" };
      });
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, dialRef]);

  // The card always centres on its own turn's tick (the stack clamped inside the lane), so it moves
  // exactly as far as the tick does. Mark the peeked band, and draw the funnel from the card's
  // TARGET box (the card glides there; a mid-glide rect would lag).
  useLayoutEffect(() => {
    const card = cardRef.current;
    const lane = laneRef.current;
    const dial = dialRef.current;
    const funnel = funnelRef.current;
    if (!peek || !card || !lane || !dial || !funnel) return;
    const h = card.offsetHeight;
    const top = (tickYs(dial, lane)[peek.index] ?? h / 2) - h / 2;
    const ghost = (side: string) => {
      const el = card.querySelector<HTMLElement>(`[data-ghost="${side}"]`);
      return el ? el.offsetHeight + EDGE : 0;
    };
    const placed = Math.max(
      EDGE + ghost("above"),
      Math.min(lane.clientHeight - h - EDGE - ghost("below"), top),
    );
    card.style.top = `${placed}px`;
    box.current = { top: placed, bottom: placed + h };
    const turn = turns[peek.index];
    const band = turn && dial.querySelector<HTMLElement>(`[data-key="${CSS.escape(turn.first)}"]`);
    if (!band) return;
    band.dataset.peeked = "";
    const origin = lane.getBoundingClientRect();
    const b = band.getBoundingClientRect();
    const x0 = card.getBoundingClientRect().right - origin.left; // x never animates; only top does
    const x1 = b.left - origin.left;
    funnel.setAttribute(
      "points",
      `${x0},${placed} ${x1},${b.top - origin.top} ${x1},${b.bottom - origin.top} ${x0},${placed + h}`,
    );
    return () => {
      delete band.dataset.peeked;
    };
  });

  if (!peek) return null;
  const turn = turns[peek.index];
  if (!turn) return null;
  const prev = turns[peek.index - 1];
  const next = turns[peek.index + 1];
  const lane = laneRef.current;

  return (
    <>
      {/* The funnel is also the bridge: the pointer crossing from the tick to the card rides it,
          so the diagonal never falls into a gap and closes the peek. */}
      <svg {...annotation("peek-funnel")} aria-hidden="true">
        <polygon ref={funnelRef} onPointerEnter={linger} onPointerLeave={close} />
      </svg>
      {/* The column only places the card beside the rail; it takes no pointer. The hit area is the
          card's own box (ghosts included) plus a gutter of grace, so leaving sideways, or past a
          ghost, closes the peek. */}
      <div {...annotation("peek-column")}>
        <div
          {...annotation("peek")}
          ref={cardRef}
          data-enter={peek.enter}
          onPointerEnter={linger}
          onPointerLeave={close}
          onPointerMove={(event) => {
            if (!lane || event.buttons !== 0) return;
            const dial = dialRef.current;
            if (!dial) return;
            // Past an edge the pointer scrubs the rail 1:1 from where it crossed; moving back toward
            // the card never scrubs, it only re-bases, so the card can always be reached and clicked.
            const y = event.clientY - lane.getBoundingClientRect().top;
            const { top, bottom } = box.current;
            if (y >= top && y <= bottom) {
              scrub.current = null;
              return;
            }
            const dir = y > bottom ? 1 : -1;
            const ticks = tickYs(dial, lane);
            const at = ticks[peek.index] ?? y;
            if (!scrub.current || scrub.current.dir !== dir)
              scrub.current = { dir, offset: y - at };
            const target = y - scrub.current.offset;
            if (dir * (target - at) < 0) {
              scrub.current.offset = y - at;
              return;
            }
            let nearest = peek.index;
            ticks.forEach((t, i) => {
              if (Math.abs(t - target) < Math.abs((ticks[nearest] ?? 0) - target)) nearest = i;
            });
            if (dir * (nearest - peek.index) > 0)
              setPeek({ index: nearest, enter: dir > 0 ? "down" : "up" });
          }}
        >
          {prev ? <TurnCard turn={prev} ghost="above" onGo={goTo} /> : null}
          <TurnCard key={turn.first} turn={turn} onGo={goTo} />
          {next ? <TurnCard turn={next} ghost="below" onGo={goTo} /> : null}
        </div>
      </div>
    </>
  );
}

function TurnCard({
  turn,
  ghost,
  onGo,
}: {
  turn: Turn;
  ghost?: "above" | "below";
  onGo: (key: string) => void;
}) {
  const time = formatTime(turn.at);
  return (
    <button
      type="button"
      {...annotation("peek-card")}
      data-ghost={ghost}
      tabIndex={-1}
      onClick={() => onGo(turn.first)}
    >
      <span {...annotation("peek-head")}>
        #{turn.turn}
        {time ? ` · ${time}` : null}
      </span>
      {turn.ask ? <span {...annotation("peek-ask")}>{turn.ask}</span> : null}
      {turn.answer ? <span {...annotation("peek-answer")}>{turn.answer}</span> : null}
    </button>
  );
}

/** Each turn's tick y, lane-relative, by turn index. */
function tickYs(dial: HTMLElement, lane: HTMLElement): number[] {
  const origin = lane.getBoundingClientRect().top;
  const ys: number[] = [];
  for (const tick of dial.querySelectorAll<HTMLElement>('[data-annotation="dial-tick"]'))
    ys[Number(tick.dataset.index)] = tick.getBoundingClientRect().top - origin;
  return ys;
}
