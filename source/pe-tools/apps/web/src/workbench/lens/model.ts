import { token } from "#/lib/token";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useAtomValue } from "@effect/atom-react";
import { useThreadMessages } from "../aui";
import { useCacheView } from "../world";
import { useWorkbench } from "../provider";
import { useThreadScope } from "#/chat/scope";
import { selectBreakdown } from "../chat-state";
import {
  lensScrollIntent,
  nextTailFollowState,
  scrollTopForIntent,
  turnAtFocalPoint,
  type TailFollowState,
} from "../model";
import type { Geom } from "./scale";
import { FOCAL, HEAD_H, MIN_BAND, SCALE } from "./scale";
import { TARGET_RAIL_COLOR, buildTraceCells, toMoments } from "./context-strip";
import type { Mode } from "../depth";
import type { ChatState } from "../chat-state";

export function useLensModel({
  state,
  mode,
  initialTurn,
  scrollKey = "",
  onTurnChange,
  sideOpen = true,
}: {
  state: ChatState;
  mode: Mode;
  initialTurn?: number;
  scrollKey?: string;
  onTurnChange?: (turn: number | undefined) => void;
  sideOpen?: boolean;
}) {
  const messages = useThreadMessages();

  const moments = toMoments(messages);

  const traceCells = buildTraceCells(state);

  const breakdown = useMemo(() => selectBreakdown(state), [state]);

  const userTurns = moments.reduce(
    (count, moment) => (moment.role === "user" ? count + 1 : count),
    0,
  );

  const cache = useCacheView(breakdown, userTurns);

  const { currentThreadId, revit } = useWorkbench();
  const threadScope = useThreadScope(currentThreadId, revit === true);
  // The rail is the thread Scope: set (session named) reads as meta, absent as muted.
  const targetTone = threadScope.scope.kind === "none" ? "muted" : "meta";

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

  const { store } = useWorkbench();

  const inspectKey = useAtomValue(store.atoms.lensInspectKey);

  const setInspectKey = store.actions.setLensInspectKey;

  const turnRef = useRef<number | undefined>(initialTurn);

  const initialTurnRef = useRef(initialTurn);

  initialTurnRef.current = initialTurn;

  const tailFollowRef = useRef<TailFollowState>(initialTurn ? "detached" : "following");

  const following = useAtomValue(store.atoms.lensFollowing);

  const setFollowing = store.actions.setLensFollowing;

  const scrollTopRef = useRef(0);

  const initialScrollRef = useRef({ key: "", done: false });

  const [, bumpMeasure] = useReducer((tick: number) => tick + 1, 0);

  const bumpPending = useRef(false);

  const initialScrollKey = scrollKey;

  if (initialScrollRef.current.key !== initialScrollKey) {
    initialScrollRef.current = { key: initialScrollKey, done: false };
    turnRef.current = initialTurn;
    tailFollowRef.current = initialTurn ? "detached" : "following";
    scrollTopRef.current = 0;
  }

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

  // Register each assistant-ui-rendered moment's DOM node so the scroll controller can
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
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const startY = event.clientY;
    const startScroll = scroller.scrollTop;
    const bandKey = (event.target as HTMLElement).closest<HTMLElement>(".mapdial-band")?.dataset
      .key;
    let dragged = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) > 3) dragged = true;
      if (dragged) scroller.scrollTop = startScroll + (ev.clientY - startY) / SCALE;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragged && bandKey) {
        const g = geomRef.current.find((geom) => geom.key === bandKey);
        if (g)
          scroller.scrollTo({ top: g.top - FOCAL * scroller.clientHeight, behavior: "smooth" });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }, []);

  // Jump-to-tail: re-attach follow and scroll to the bottom (the re-measure snap keeps it there).
  const scrollToTail = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    tailFollowRef.current = "following";
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
  }, []);

  // The single scroll controller: candlestick + bands + chat stubs + pinned fisheye cards.
  // Mutates refs only (no per-frame React render). Re-measures on resize and on row changes.
  useEffect(() => {
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

      const metrics = { scrollTop: s, scrollHeight: scroller.scrollHeight, clientHeight: V };
      const nextTurn =
        tailFollowRef.current === "following" ? undefined : turnAtFocalPoint(geom, metrics, FOCAL);
      if (nextTurn !== turnRef.current) {
        turnRef.current = nextTurn;
        onTurnChange?.(nextTurn);
      }
      setFollowing(tailFollowRef.current === "following");

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
          const parent = marker.closest<HTMLElement>(".lens-moment")?.dataset.key;
          if (!toolId || !parent) continue;
          const anchor = marker.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
          const key = `tool:${toolId}`;
          cardAnchors.push({ key, parent, anchor });
          const rail = marker.querySelector<HTMLElement>(".lens-marker");
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
      if (!initialScrollRef.current.done) {
        scroller.scrollTop = scrollTopForIntent(
          lensScrollIntent(initialTurnRef.current),
          geom,
          metrics,
          FOCAL,
        );
        initialScrollRef.current.done = true;
      } else if (tailFollowRef.current === "following") {
        scroller.scrollTop = scrollTopForIntent({ kind: "tail" }, geom, metrics, FOCAL);
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
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    const onScroll = () => {
      const metrics = {
        scrollTop: scroller.scrollTop,
        scrollHeight: scroller.scrollHeight,
        clientHeight: scroller.clientHeight,
      };
      tailFollowRef.current = nextTailFollowState(
        tailFollowRef.current,
        metrics,
        scrollTopRef.current,
      );
      scrollTopRef.current = scroller.scrollTop;
      schedule();
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });

    // Transcript turn-number tags dispatch this (aui.tsx TurnTag): center that turn on the focal
    // axis — same gesture as tapping its mapdial band.
    const onFocusTurn = (event: Event) => {
      const turn = (event as CustomEvent<number>).detail;
      if (!Number.isFinite(turn)) return;
      tailFollowRef.current = "detached";
      scroller.scrollTop = scrollTopForIntent(
        lensScrollIntent(turn),
        geomRef.current,
        {
          scrollTop: scroller.scrollTop,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
        },
        FOCAL,
      );
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
    const onTraceOver = (e: Event) => setHover(keyFrom(e, ".lens-cell"));
    chat?.addEventListener("mouseover", onChatOver);
    chat?.addEventListener("mouseleave", onChatLeave);
    trace?.addEventListener("mouseover", onTraceOver);
    trace?.addEventListener("mouseleave", onChatLeave);

    return () => {
      ro.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("pe:focus-turn", onFocusTurn);
      cancelAnimationFrame(raf);
      chat?.removeEventListener("mouseover", onChatOver);
      chat?.removeEventListener("mouseleave", onChatLeave);
      trace?.removeEventListener("mouseover", onTraceOver);
      trace?.removeEventListener("mouseleave", onChatLeave);
    };
    // moments/traceCells are fresh arrays each render; re-running re-measures geometry as the
    // thread (and streaming text heights) change. The register callback re-measures once aui
    // mounts the moment sections. `sideOpen` is here so expanding the collapsed rail re-runs the
    // controller and measures the freshly-mounted trace cards (the scroller itself doesn't resize
    // when the lane collapses, so nothing else would trigger a re-measure). Hover survives via
    // hoverKeyRef.
  }, [moments, traceCells, mode, onTurnChange, sideOpen]);
  return {
    moments,
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
