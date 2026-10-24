import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useCacheView } from "../world";
import { useWorkbench } from "../provider";
import { useCurrentThreadView } from "../thread-view";
import { selectBreakdown, selectMessages } from "@pe/agent-contracts/chat-state";
import { intentAt, scrollTopForIntent } from "../model";
import type { Geom } from "./scale";
import { FOCAL, railLayout, type RailLayout } from "./scale";
import { toMoments } from "./moments";
import type { ChatState } from "@pe/agent-contracts/chat-state";

/** Within this many px of the bottom, the view counts as at the bottom and follows. */
const FOLLOW_SLACK = 24;

/** Rail px kept clear at each end of the lane once the stack fills it. */
const RAIL_MARGIN = 16;

export function useLensModel({ state }: { state: ChatState }) {
  const messages = useMemo(() => selectMessages(state), [state]);

  const moments = useMemo(() => toMoments(messages), [messages]);

  const breakdown = useMemo(() => selectBreakdown(state), [state]);

  const userTurns = moments.reduce(
    (count, moment) => (moment.role === "user" ? count + 1 : count),
    0,
  );

  const cache = useCacheView(breakdown, userTurns);

  const { loading } = useWorkbench();

  const frameRef = useRef<HTMLDivElement>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);

  const chatRef = useRef<HTMLDivElement>(null);

  const dialRef = useRef<HTMLDivElement>(null);

  const thumbRef = useRef<HTMLDivElement>(null);

  const momentRefs = useRef(new Map<string, HTMLElement>());

  const bandRefs = useRef(new Map<string, HTMLElement>());

  /** One tick per turn, at the bottom edge of its last band. */
  const tickRefs = useRef(new Map<number, HTMLElement>());

  const geomRef = useRef<Geom[]>([]);

  const view = useCurrentThreadView();

  // The position intent lives in the store (`lensIntent`); follow is derived from it. The store
  // is per thread (WorkbenchProvider is keyed on it), so nothing here resets on a thread switch.
  const intent = useCallback(() => view.registry.get(view.atoms.lensIntent), [view]);
  const setIntent = view.actions.setLensIntent;

  // The opening position is placed ONCE — the URL's turn, else the tail. After that the view
  // follows the newest event only while the user sits at the bottom; a scroll up stops it, a scroll
  // back down (or jump-to-tail) resumes it. This overrules F-J1's no-follow (drive, 2026-10-01).
  const landedRef = useRef(false);
  const followRef = useRef(false);
  const [awayFromTail, setAwayFromTail] = useState(false);
  const awayRef = useRef(false);

  const [measureRevision, bumpMeasure] = useReducer((tick: number) => tick + 1, 0);

  const bumpPending = useRef(false);

  // Register each rendered moment's DOM node so the scroll controller can
  // measure it (bands, fisheye). Keyed by message id — aligned with `moments`. Each
  // register/unregister schedules a re-measure so geometry tracks the async mount.
  const registerMoment = useCallback((id: string, el: HTMLElement | null) => {
    if (el) momentRefs.current.set(id, el);
    else momentRefs.current.delete(id);
    // Coalesce a burst of registers (one per moment) into a single re-render.
    if (!bumpPending.current) {
      bumpPending.current = true;
      queueMicrotask(() => {
        bumpPending.current = false;
        bumpMeasure();
      });
    }
  }, []);

  // Center a moment's turn on a click. A press that moves is a scrub instead (below); the click is
  // then swallowed, so the two gestures no longer fight.
  const goTo = useCallback(
    (key: string) => {
      const scroller = scrollerRef.current;
      const g = geomRef.current.find((geom) => geom.key === key);
      if (!scroller || !g) return;
      landedRef.current = true;
      setIntent({ kind: "turn", turn: g.turn });
      scroller.scrollTo({ top: g.top - FOCAL * scroller.clientHeight, behavior: "smooth" });
    },
    [setIntent],
  );

  // Jump-to-tail: the one thing that puts the view at the bottom, and only when pressed. The press
  // lives beside the lens and above the composer, which dispatch `pe:focus-tail`.
  useEffect(() => {
    const onTail = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      landedRef.current = true;
      scroller.scrollTo({ top: scroller.scrollHeight - scroller.clientHeight, behavior: "smooth" });
    };
    window.addEventListener("pe:focus-tail", onTail);
    return () => window.removeEventListener("pe:focus-tail", onTail);
  }, []);

  // The single scroll controller: reticle + bands + the stored position.
  // Mutates refs only (no per-frame React render). Re-measures on resize and on row changes.
  // A layout effect: the snap lands after the grown content is laid out and before it paints.
  // The scroller has no CSS smooth scrolling, so every `scrollTop =` here is instant.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const frame = frameRef.current;
    const dial = dialRef.current;
    if (!scroller || !frame || !dial) return;

    const atBottom = () =>
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < FOLLOW_SLACK;

    let geom: Geom[] = [];
    // Doc y → rail y (`railLayout`): the thread fits the rail like a scrollbar; nothing slides.
    let map: RailLayout = {
      bands: new Map(),
      at: () => 0,
      inv: () => 0,
      notches: new Map(),
      height: 0,
    };

    const sync = () => {
      const s = scroller.scrollTop;
      const V = scroller.clientHeight;
      const away = !atBottom();
      if (away !== awayRef.current) {
        awayRef.current = away;
        setAwayFromTail(away);
      }
      // the thumb: the viewport's extent on the fixed map
      const thumbTop = map.at(s);
      if (thumbRef.current) {
        thumbRef.current.style.top = `${thumbTop}px`;
        thumbRef.current.style.height = `${map.at(s + V) - thumbTop}px`;
      }

      // The intent is what a reload reopens: the tail while at the bottom, else the focal turn.
      // Not before the opening position has landed: a scroll before that is not the user's.
      if (landedRef.current) {
        const metrics = { scrollTop: s, scrollHeight: scroller.scrollHeight, clientHeight: V };
        const next = intentAt(geom, metrics, FOCAL, FOLLOW_SLACK);
        if (next) setIntent(next);
      }

      // which stub sits on the focal axis?
      const focalDoc = s + FOCAL * V;
      let fk: string | null = null;
      for (const g of geom) {
        if (g.top <= focalDoc && focalDoc < g.top + g.height) {
          fk = g.key;
          break;
        }
        if (g.top <= focalDoc) fk = g.key;
      }
      // No focal mark on the moment: the dial band is the one "where am I" (its own `.focal`).
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        band.classList.toggle("in-view", g.top + g.height > s && g.top < s + V);
        band.classList.toggle("focal", g.key === fk);
      }
    };

    const measure = () => {
      // One geom per turn, keyed by its first moment: the rail's unit is the turn, the same unit
      // its ticks and the peek speak.
      const byTurn = new Map<number, Geom>();
      for (const moment of moments) {
        const el = momentRefs.current.get(moment.id);
        if (!el) continue;
        const bottom = el.offsetTop + el.offsetHeight;
        // The moment's rendered blocks: its `data-blocks` column's children (a collapsed tool run is
        // one child), else the moment itself.
        const blocks: number[] = [];
        const column = el.querySelector("[data-blocks]");
        if (column) {
          const origin = el.getBoundingClientRect().top - el.offsetTop;
          for (const block of column.children)
            if (block.getAttribute("data-annotation") !== "streaming-caret")
              blocks.push(block.getBoundingClientRect().top - origin);
        }
        if (blocks.length === 0) blocks.push(el.offsetTop);
        const g = byTurn.get(moment.turn);
        if (g) {
          g.height = bottom - g.top;
          g.blocks.push(...blocks);
        } else
          byTurn.set(moment.turn, {
            key: moment.id,
            turn: moment.turn,
            top: el.offsetTop,
            height: el.offsetHeight,
            blocks,
          });
      }
      geom = [...byTurn.values()];
      geomRef.current = geom;
      // The dial is a scrollbar's stand-in: a thread that fits the lane has nowhere to go.
      frame.toggleAttribute("data-scrolls", scroller.scrollHeight > scroller.clientHeight + 1);
      // The rail centres in the lane and stops short of the pane head and the composer.
      const lane = dial.parentElement ?? scroller;
      map = railLayout(geom, scroller.scrollHeight, lane.clientHeight - RAIL_MARGIN * 2);
      dial.style.height = `${map.height}px`;
      const bottoms = new Map<number, number>();
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        const box = map.bands.get(g.key)!;
        band.style.top = `${box.top}px`;
        band.style.height = `${box.height}px`;
        // A page-coloured hairline cuts the bar at each rendered block's top, so the slot
        // reads as its blocks. One gradient per band; no extra DOM.
        const notches = map.notches.get(g.key);
        band.style.backgroundImage = notches?.length
          ? `linear-gradient(to bottom, ${notches
              .map(
                (y) =>
                  `transparent ${y}px, var(--pe-page) ${y}px, var(--pe-page) ${y + 1}px, transparent ${y + 1}px`,
              )
              .join(", ")})`
          : "";
        bottoms.set(g.turn, box.top + box.height);
      }
      for (const [turn, tick] of tickRefs.current) {
        const bottom = bottoms.get(turn);
        tick.hidden = bottom === undefined;
        if (bottom !== undefined) tick.style.top = `${bottom}px`;
      }
      const metrics = {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      };
      // The opening position, placed ONCE. A later re-measure (streaming text, an image, a tool
      // body) moves the scroller only to keep a following view at the bottom.
      const current = intent();
      if (!landedRef.current && geom.length > 0) {
        if (current.kind === "tail") {
          scroller.scrollTop = scrollTopForIntent(current, geom, metrics, FOCAL);
          landedRef.current = true;
        } else if (geom.some((g) => g.turn === current.turn && g.height > 0)) {
          scroller.scrollTop = scrollTopForIntent(current, geom, metrics, FOCAL);
          landedRef.current = true;
        } else if (!loading && !moments.some((moment) => moment.turn === current.turn)) {
          // The thread is here and has no such turn: open at the tail instead.
          scroller.scrollTop = scrollTopForIntent({ kind: "tail" }, geom, metrics, FOCAL);
          landedRef.current = true;
        }
        // A short thread never scrolls, so the landing decides follow, not a scroll event.
        followRef.current = landedRef.current && atBottom();
      } else if (landedRef.current && followRef.current) {
        scroller.scrollTop = scrollTopForIntent({ kind: "tail" }, geom, metrics, FOCAL);
      }
      sync();
    };

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };

    measure();
    // The box AND the content: a message that grows after render (highlighting, an image, a tool
    // body) re-measures the dial's geometry. It does NOT move the scroller.
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (chatRef.current) ro.observe(chatRef.current);
    // The lane shrinks as the composer grows; the rail refits to what is left.
    if (dial.parentElement) ro.observe(dial.parentElement);
    // A scroll re-draws the dial and decides follow: at the bottom (within a line) follows.
    const onScroll = () => {
      followRef.current = atBottom();
      schedule();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    const unscrub = scrubRail(
      dial,
      scroller,
      thumbRef,
      () => map,
      () => {
        landedRef.current = true;
      },
    );

    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      unscrub();
      cancelAnimationFrame(raf);
    };
    // Unrelated route renders do not remeasure chat. Content, mounting and resize still do.
  }, [moments, measureRevision, loading, intent, setIntent]);
  // An empty thread is a claim; while the body loads it is not known (the composer head says so).
  const showEmpty = !loading && moments.length === 0;
  return {
    messages,
    moments,
    showEmpty,
    breakdown,
    userTurns,
    cache,
    frameRef,
    scrollerRef,
    chatRef,
    dialRef,
    thumbRef,
    bandRefs,
    tickRefs,
    registerMoment,
    goTo,
    awayFromTail,
  };
}

/**
 * Drag-to-scrub: a press on the rail that moves drags the thumb through the rail's own map (`inv`),
 * so inside a slot the pointer lands proportionally inside that turn. A press on the thumb keeps its
 * grip offset; elsewhere the thumb centres under the pointer. The scroller is written directly per
 * move (no React render); the click that would follow a scrub is swallowed ahead of the peek's
 * click, so a scrub never also jumps. A press without a move is that click: the peek resolves it to
 * the turn at its height (peek.tsx). The funnel of an open peek is part of the press area; it exists
 * only while a peek is open, so the transcript never loses a press.
 */
export function scrubRail(
  dial: HTMLElement,
  scroller: HTMLElement,
  thumbRef: { current: HTMLElement | null },
  map: () => RailLayout,
  onScrub: () => void,
): () => void {
  const lane = dial.parentElement ?? dial;
  let drag: { offset: number; startY: number; moved: boolean } | null = null;
  let swallowClick = false;
  const railY = (event: PointerEvent) => event.clientY - dial.getBoundingClientRect().top;
  const onDown = (event: PointerEvent) => {
    const press = (event.target as Element).closest(
      '[data-annotation="dial"], [data-annotation="peek-funnel"]',
    );
    if (event.button !== 0 || !press) return;
    const y = railY(event);
    const thumb = thumbRef.current;
    const top = parseFloat(thumb?.style.top ?? "") || 0;
    const height = parseFloat(thumb?.style.height ?? "") || 0;
    const onThumb = y >= top && y <= top + height;
    drag = { offset: onThumb ? y - top : height / 2, startY: event.clientY, moved: false };
    dial.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(event.clientY - drag.startY) < 3) return;
    drag.moved = true;
    dial.dataset.scrub = "";
    onScrub();
    scroller.scrollTop = map().inv(railY(event) - drag.offset);
  };
  const onUp = () => {
    if (!drag) return;
    swallowClick = drag.moved;
    drag = null;
    delete dial.dataset.scrub;
  };
  const onClickCapture = (event: MouseEvent) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.stopImmediatePropagation();
  };
  lane.addEventListener("pointerdown", onDown);
  dial.addEventListener("pointermove", onMove);
  dial.addEventListener("pointerup", onUp);
  dial.addEventListener("pointercancel", onUp);
  dial.addEventListener("click", onClickCapture, true);
  return () => {
    lane.removeEventListener("pointerdown", onDown);
    dial.removeEventListener("pointermove", onMove);
    dial.removeEventListener("pointerup", onUp);
    dial.removeEventListener("pointercancel", onUp);
    dial.removeEventListener("click", onClickCapture, true);
  };
}
