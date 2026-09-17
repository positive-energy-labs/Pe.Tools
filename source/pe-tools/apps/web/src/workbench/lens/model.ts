import { token } from "#/lib/token";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useCacheView } from "../world";
import { useWorkbench } from "../provider";
import { useCurrentThreadView } from "../thread-view";
import { useThreadScope } from "#/chat/scope";
import { selectBreakdown, selectMessages } from "../chat-state";
import {
  lensScrollIntent,
  nextTailFollowState,
  type LensScrollIntent,
  scrollTopForIntent,
  turnAtFocalPoint,
  type TailFollowState,
} from "../model";
import type { Geom } from "./scale";
import { FOCAL, HEAD_H, MIN_BAND, SCALE } from "./scale";
import { TARGET_RAIL_COLOR, buildTraceCells, toMoments } from "./context-strip";
import type { Mode } from "../depth";
import type { ChatState } from "../chat-state";

const USER_INPUT_MS = 800;
const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export function useLensModel({
  state,
  mode,
  sideOpen = true,
}: {
  state: ChatState;
  mode: Mode;
  sideOpen?: boolean;
}) {
  const messages = useMemo(() => selectMessages(state), [state]);

  const moments = toMoments(messages);

  const traceCells = buildTraceCells(state);

  const breakdown = useMemo(() => selectBreakdown(state), [state]);

  const userTurns = moments.reduce(
    (count, moment) => (moment.role === "user" ? count + 1 : count),
    0,
  );

  const cache = useCacheView(breakdown, userTurns);

  const { currentThreadId, revit, loading } = useWorkbench();
  const threadScope = useThreadScope(currentThreadId, revit === true);
  // The rail is the thread head: a chosen document reads as meta, none as muted.
  const targetTone = threadScope.defaultTarget === null ? "muted" : "meta";

  const targetRailColor = TARGET_RAIL_COLOR[targetTone] ?? token("ink-mute");

  const frameRef = useRef<HTMLDivElement>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);

  const chatRef = useRef<HTMLDivElement>(null);

  const traceInnerRef = useRef<HTMLDivElement>(null);

  const stripRef = useRef<HTMLDivElement>(null);

  const wickRef = useRef<HTMLDivElement>(null);

  const capTopRef = useRef<HTMLDivElement>(null);

  const capBotRef = useRef<HTMLDivElement>(null);

  const csFocalRef = useRef<HTMLDivElement>(null);

  const caretRef = useRef<HTMLDivElement>(null);

  const momentRefs = useRef(new Map<string, HTMLElement>());

  const bandRefs = useRef(new Map<string, HTMLElement>());

  const cardRefs = useRef(new Map<string, HTMLElement>());

  const geomRef = useRef<Geom[]>([]);

  const hoverKeyRef = useRef<string | null>(null);

  const focalToolRef = useRef<string | null>(null);

  const view = useCurrentThreadView();

  const inspectKey = useAtomValue(view.atoms.lensInspectKey);

  const setInspectKey = view.actions.setLensInspectKey;

  // The position intent lives in the store (`lensIntent`); follow is derived from it. The store
  // is per thread (WorkbenchProvider is keyed on it), so nothing here resets on a thread switch.
  const intent = useCallback(() => view.registry.get(view.atoms.lensIntent), [view]);
  const setIntent = view.actions.setLensIntent;

  const following = useAtomValue(view.atoms.lensFollowing);

  const scrollTopRef = useRef(0);

  // A `turn` intent from the URL is not realised until its moment has registered with geometry.
  // Until then every measure retries; user input takes over from it.
  const landedRef = useRef(false);

  // The last wheel/touch/key/drag. A scroll event this soon after one is the user's.
  const userInputAtRef = useRef(-Infinity);

  const [, bumpMeasure] = useReducer((tick: number) => tick + 1, 0);

  const bumpPending = useRef(false);

  useEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollerRef.current;
    if (!frame || !scroller) return;
    const apply = () => frame.style.setProperty("--vp", `${scroller.clientHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

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

  // drag the gutter to scrub (gutter motion ÷ SCALE = chat motion); a tap centers the band.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const startY = event.clientY;
      const startScroll = scroller.scrollTop;
      const bandKey = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-annotation="dial-band"]',
      )?.dataset.key;
      let dragged = false;
      const move = (ev: PointerEvent) => {
        if (Math.abs(ev.clientY - startY) > 3) dragged = true;
        if (!dragged) return;
        userInputAtRef.current = performance.now();
        scroller.scrollTop = startScroll + (ev.clientY - startY) / SCALE;
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        if (!dragged && bandKey) {
          const g = geomRef.current.find((geom) => geom.key === bandKey);
          if (g) {
            // A tap detaches first, so no follow snap fights the animation.
            landedRef.current = true;
            setIntent({ kind: "turn", turn: g.turn });
            scroller.scrollTo({ top: g.top - FOCAL * scroller.clientHeight, behavior: "smooth" });
          }
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [setIntent],
  );

  // Jump-to-tail: re-attach follow and snap to the bottom (the re-measure snap keeps it there).
  const scrollToTail = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    landedRef.current = true;
    setIntent({ kind: "tail" });
    scroller.scrollTop = scroller.scrollHeight - scroller.clientHeight;
  }, [setIntent]);

  // The single scroll controller: candlestick + bands + chat stubs + pinned fisheye cards.
  // Mutates refs only (no per-frame React render). Re-measures on resize and on row changes.
  // A layout effect: the snap lands after the grown content is laid out and before it paints.
  // The scroller has no CSS smooth scrolling, so every `scrollTop =` here is instant.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const frame = frameRef.current;
    const strip = stripRef.current;
    if (!scroller || !frame || !strip) return;

    const detailKeys = new Set(traceCells.map((cell) => cell.key));

    let geom: Geom[] = [];
    let cards: { key: string; el: HTMLElement }[] = [];
    // Each tool card is anchored to its inline marker's real doc-y in the chat (measured below).
    // The focal card is the one whose anchor is nearest the focal axis — so scrolling walks the
    // focal card to whatever tool is actually at the axis, one at a time, not the whole group.
    let cardAnchors: { key: string; parent: string; anchor: number }[] = [];
    // The inline chat marker for each tool key, so only the single focal tool's rail lights up.
    let markerByKey = new Map<string, HTMLElement>();

    // The lane is now a static list of fixed-height rows: no expand-in-place, no debounce, no
    // height pump. POSITION still tracks continuously (the row nearest the focal axis rides it);
    // the tool's I/O renders in the pinned inspect window up top instead (React state, coarse).
    const laneCenterOf = (key: string | null): number => {
      const cell = key ? cards.find((c) => c.key === key)?.el : undefined;
      return cell ? cell.offsetTop + cell.offsetHeight / 2 : 0;
    };
    const layoutLane = (V: number, anchorKey: string | null) => {
      const inner = traceInnerRef.current;
      // The lane body starts HEAD_H below the viewport top (under the sticky sidebar head), so
      // subtract it to land the focal row on the same axis as the chat's focal message.
      if (inner)
        inner.style.transform = `translateY(${FOCAL * V - HEAD_H - laneCenterOf(anchorKey)}px)`;
    };
    const updateInspect = () => setInspectKey(hoverKeyRef.current ?? focalToolRef.current);
    const positionLane = (V: number, focalCardKey: string | null) => {
      layoutLane(V, focalCardKey);
      const hoverKey = hoverKeyRef.current;
      for (const c of cards) {
        c.el.classList.toggle("focal", c.key === focalCardKey);
        c.el.classList.toggle("hover", c.key === hoverKey && c.key !== focalCardKey);
      }
      focalToolRef.current = focalCardKey;
      updateInspect();
    };

    const sync = () => {
      const s = scroller.scrollTop;
      const V = scroller.clientHeight;
      const focalG = FOCAL * V;
      const fy = FOCAL * V;

      // candlestick: horizontal focal bar + vertical wick (the viewport extent)
      const wickTop = focalG - SCALE * FOCAL * V;
      const wickH = SCALE * V;
      if (wickRef.current) {
        wickRef.current.style.top = `${wickTop}px`;
        wickRef.current.style.height = `${wickH}px`;
      }
      if (capTopRef.current) capTopRef.current.style.top = `${wickTop}px`;
      if (capBotRef.current) capBotRef.current.style.top = `${wickTop + wickH}px`;
      if (csFocalRef.current) csFocalRef.current.style.top = `${fy}px`;
      if (caretRef.current) caretRef.current.style.top = `${fy}px`;

      // While detached, the intent tracks the turn on the focal axis (what a reload reopens).
      // Not before a URL turn has landed: a scroll before that is not the user's.
      const current = intent();
      if (current.kind === "turn" && landedRef.current) {
        const metrics = { scrollTop: s, scrollHeight: scroller.scrollHeight, clientHeight: V };
        const turn = turnAtFocalPoint(geom, metrics, FOCAL);
        if (turn !== undefined && turn !== current.turn) setIntent({ kind: "turn", turn });
      }

      strip.style.transform = `translateY(${focalG - SCALE * (s + FOCAL * V)}px)`;

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
      const hoverKey = hoverKeyRef.current;
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (band) {
          const on = g.top + g.height > s && g.top < s + V;
          band.classList.toggle("in-reticle", on);
          band.classList.toggle("focal", g.key === fk);
        }
        const moment = momentRefs.current.get(g.key);
        if (moment) {
          moment.classList.toggle("focal", g.key === fk);
          moment.classList.toggle("hover", g.key === hoverKey);
        }
      }

      // The focal card = the LAST tool whose inline marker sits at or above the focal axis —
      // chronological reading: between tools, the previous one stays lit (it's the one whose
      // output the axis is currently inside). Before the first tool, fall back to the first.
      let focalCardKey: string | null = null;
      for (const card of cardAnchors) {
        if (card.anchor <= focalDoc) focalCardKey = card.key;
        else break;
      }
      if (!focalCardKey && cardAnchors.length > 0) focalCardKey = cardAnchors[0]!.key;
      // Light up only that single tool's chat rail (not the whole message's tool group).
      for (const [key, rail] of markerByKey)
        rail.classList.toggle("tool-focal", key === focalCardKey);
      positionLane(V, focalCardKey);
    };

    const measure = () => {
      geom = moments.flatMap((moment) => {
        const el = momentRefs.current.get(moment.id);
        return el
          ? [
              {
                key: moment.id,
                turn: moment.turn,
                top: el.offsetTop,
                height: el.offsetHeight,
              },
            ]
          : [];
      });
      geomRef.current = geom;
      // Anchor each tool card to its inline marker's real doc-y in the chat scroll space, so the
      // focal-card pick matches the tool the user sees at the focal axis. `parent` is the
      // enclosing message id, so the focal-message filter in sync() stays consistent.
      cardAnchors = [];
      markerByKey = new Map();
      const chat = chatRef.current;
      if (chat) {
        const scrollerTop = scroller.getBoundingClientRect().top;
        for (const marker of chat.querySelectorAll<HTMLElement>("[data-tool-id]")) {
          const toolId = marker.dataset.toolId;
          const parent = marker.closest<HTMLElement>('[data-annotation="moment"]')?.dataset.key;
          if (!toolId || !parent) continue;
          const anchor = marker.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
          const key = `tool:${toolId}`;
          cardAnchors.push({ key, parent, anchor });
          const rail = marker.querySelector<HTMLElement>('[data-annotation="tool-marker"]');
          if (rail) markerByKey.set(key, rail);
        }
      }
      cards = traceCells.flatMap((cell) => {
        const el = cardRefs.current.get(cell.key);
        return el ? [{ key: cell.key, el }] : [];
      });
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        band.style.top = `${g.top * SCALE}px`;
        band.style.height = `${Math.max(MIN_BAND, g.height * SCALE)}px`;
      }
      const metrics = {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      };
      const current = intent();
      if (current.kind === "tail") {
        scroller.scrollTop = scrollTopForIntent(current, geom, metrics, FOCAL);
      } else if (!landedRef.current) {
        if (geom.some((g) => g.turn === current.turn && g.height > 0)) {
          scroller.scrollTop = scrollTopForIntent(current, geom, metrics, FOCAL);
          landedRef.current = true;
        } else if (!loading && !moments.some((moment) => moment.turn === current.turn)) {
          // The thread is here and has no such turn: open at the tail instead.
          setIntent({ kind: "tail" });
          scroller.scrollTop = scrollTopForIntent({ kind: "tail" }, geom, metrics, FOCAL);
        }
      }
      scrollTopRef.current = scroller.scrollTop;
      sync();
    };

    const setHover = (key: string | null | undefined) => {
      const next = key && detailKeys.has(key) ? key : null;
      if (next === hoverKeyRef.current) return;
      hoverKeyRef.current = next;
      schedule();
    };
    const keyFrom = (event: Event, selector: string) =>
      (event.target as HTMLElement).closest<HTMLElement>(selector)?.dataset.key;

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(sync);
    };

    measure();
    // The box AND the content: a message that grows after render (highlighting, an image, a tool
    // body) re-measures and, while following, re-snaps before paint.
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (chatRef.current) ro.observe(chatRef.current);
    const follow = (byUser: boolean) => {
      const metrics = {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      };
      if (byUser) landedRef.current = true;
      const before: TailFollowState = intent().kind === "tail" ? "following" : "detached";
      const next = nextTailFollowState(before, metrics, scrollTopRef.current, byUser);
      if (next !== before) {
        const turn = turnAtFocalPoint(geomRef.current, metrics, FOCAL);
        setIntent(next === "following" ? { kind: "tail" } : { kind: "turn", turn: turn ?? 1 });
      }
      scrollTopRef.current = scroller.scrollTop;
      schedule();
    };
    const onScroll = () => follow(performance.now() - userInputAtRef.current < USER_INPUT_MS);
    // Touch momentum sends no input events after the finger lifts, so a long fling outruns the
    // window. The scroll's end still belongs to the gesture that started it.
    let scrollEndAt = -Infinity;
    const onScrollEnd = () => {
      const byGesture = userInputAtRef.current > scrollEndAt;
      scrollEndAt = performance.now();
      if (byGesture) follow(true);
    };
    const onUserInput = () => {
      userInputAtRef.current = performance.now();
    };
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) onUserInput();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("scrollend", onScrollEnd);
    scroller.addEventListener("wheel", onUserInput, { passive: true });
    scroller.addEventListener("touchmove", onUserInput, { passive: true });
    scroller.addEventListener("keydown", onKey);

    // Transcript turn-number tags dispatch this (moments.tsx MomentHead): center that turn on the focal
    // axis — same gesture as tapping its mapdial band.
    // Smooth is safe here: the intent detaches first, so no follow snap fights the animation.
    const onFocusTurn = (event: Event) => {
      const turn = (event as CustomEvent<number>).detail;
      if (!Number.isFinite(turn)) return;
      landedRef.current = true;
      const target: LensScrollIntent = lensScrollIntent(turn);
      setIntent(target);
      scroller.scrollTo({
        top: scrollTopForIntent(
          target,
          geomRef.current,
          {
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
          },
          FOCAL,
        ),
        behavior: "smooth",
      });
    };
    window.addEventListener("pe:focus-turn", onFocusTurn);

    const chat = chatRef.current;
    const trace = traceInnerRef.current;
    // Hovering an inline tool marker targets THAT tool (not the group's first); trace rows direct.
    const onChatOver = (e: Event) => {
      const toolId = (e.target as HTMLElement).closest<HTMLElement>("[data-tool-id]")?.dataset
        .toolId;
      setHover(toolId ? `tool:${toolId}` : undefined);
    };
    const onChatLeave = () => setHover(null);
    const onTraceOver = (e: Event) => setHover(keyFrom(e, '[data-annotation="trace-cell"]'));
    chat?.addEventListener("mouseover", onChatOver);
    chat?.addEventListener("mouseleave", onChatLeave);
    trace?.addEventListener("mouseover", onTraceOver);
    trace?.addEventListener("mouseleave", onChatLeave);

    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("scrollend", onScrollEnd);
      scroller.removeEventListener("wheel", onUserInput);
      scroller.removeEventListener("touchmove", onUserInput);
      scroller.removeEventListener("keydown", onKey);
      window.removeEventListener("pe:focus-turn", onFocusTurn);
      cancelAnimationFrame(raf);
      chat?.removeEventListener("mouseover", onChatOver);
      chat?.removeEventListener("mouseleave", onChatLeave);
      trace?.removeEventListener("mouseover", onTraceOver);
      trace?.removeEventListener("mouseleave", onChatLeave);
    };
    // moments/traceCells are fresh arrays each render; re-running re-measures geometry as the
    // thread (and streaming text heights) change. The register callback re-measures once the
    // moment sections mount. `sideOpen` is here so expanding the collapsed rail re-runs the
    // controller and measures the freshly-mounted trace cards (the scroller itself doesn't resize
    // when the lane collapses, so nothing else would trigger a re-measure). Hover survives via
    // hoverKeyRef.
  }, [moments, traceCells, mode, sideOpen, loading, intent, setIntent]);
  // An empty thread is a claim; while the body loads it is not known (the composer head says so).
  const showEmpty = !loading && moments.length === 0;
  return {
    messages,
    moments,
    showEmpty,
    traceCells,
    breakdown,
    userTurns,
    cache,
    threadScope,
    targetTone,
    targetRailColor,
    frameRef,
    scrollerRef,
    chatRef,
    traceInnerRef,
    stripRef,
    wickRef,
    capTopRef,
    capBotRef,
    csFocalRef,
    caretRef,
    bandRefs,
    cardRefs,
    inspectKey,
    following,
    registerMoment,
    onPointerDown,
    scrollToTail,
  };
}
