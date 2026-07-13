import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  WorkbenchObservationMemoryEntry,
  WorkbenchState,
  WorkbenchToolCall,
} from "@pe/agent-contracts";
import { ThreadPrimitive, type ThreadMessageLike } from "@assistant-ui/react";
import { modeDepth, type Mode } from "./depth";
import { Moments, useThreadMessages } from "./aui";
import { RouteChatPluginDock } from "./route-chat-plugins";
import { useCacheView, WorldLane } from "./world";
import { useToolIo } from "./tool-io";
import { SidePane } from "#/components/ui/side-pane";
import { imageSource } from "./adapter";
import {
  lensScrollIntent,
  nextTailFollowState,
  scrollTopForIntent,
  turnAtFocalPoint,
  type TailFollowState,
} from "./model";

/**
 * The unified workbench view (one layout, one scroll). Modes toggle panes over a single
 * parallax layout: `chat` shows chat + MapDial; `trace` adds the detail lane. The MapDial
 * gutter and candlestick focal marker are always present.
 *
 * Provenance across lanes is shown by the focal point, NOT by wires: the message on the
 * focal axis highlights, and the focal tool's I/O renders in the pinned inspect window. The chat
 * column is rendered by assistant-ui (text/reasoning/tool parts via `MessagePrimitive.Parts`),
 * but the LAYOUT — sticky MapDial, fisheye trace lane, single rAF scroll controller — stays
 * ours. assistant-ui renders each message inside a `.lens-moment` section we own (ref +
 * data-key), so the geometry controller measures it exactly as before. Moments are
 * message-granular; tools are parts of their assistant message inline AND cards in the
 * trace lane (linked to the focal message by parentMessageId).
 */

const SCALE = 0.14; // chat px -> map px. Fixed, NOT fit-to-container: long threads overflow, short leave the gutter empty.
const FOCAL = 0.5; // focal line, fraction down the gutter/viewport — centered, so the focal caret sits at the reticle box's center.
const MIN_BAND = 3; // px floor so a one-line turn stays visible and clickable.
const HEAD_H = 40; // px — the sidebar head (dial) height; the fisheye lane sits below it, so its
// translate subtracts this to keep cards on the same focal axis as the chat. Must match --side-head-h.

interface Geom {
  key: string;
  turn: number;
  top: number;
  height: number;
}

interface Moment {
  id: string;
  turn: number;
  role: "user" | "assistant" | "system";
  createdAt?: Date;
}

interface TraceCell {
  key: string;
  kind: "tool" | "memory";
  toolCall?: WorkbenchToolCall;
  memory?: WorkbenchObservationMemoryEntry;
  parentId?: string;
}

export function Lens({
  state,
  mode,
  initialTurn,
  scrollKey = "",
  onTurnChange,
  sideHead,
  threadList,
  onSideResize,
  sideOpen = true,
  onSideOpenChange,
}: {
  state: WorkbenchState;
  mode: Mode;
  initialTurn?: number;
  scrollKey?: string;
  onTurnChange?: (turn: number | undefined) => void;
  /** The always-on sidebar head (the mode dial). Rides the SidePane header. */
  sideHead?: React.ReactNode;
  /** Body for `threads` mode — the recent-thread list. */
  threadList?: React.ReactNode;
  /** SidePane drag tick — the new width in px (caller mirrors it into --side for the composer). */
  onSideResize?: (px: number) => void;
  /** SidePane open state (controlled) — collapsing it re-runs the geometry controller. */
  sideOpen?: boolean;
  /** Fired when the SidePane collapses/expands (chevron rail). */
  onSideOpenChange?: (open: boolean) => void;
}) {
  const messages = useThreadMessages();
  const moments = toMoments(messages);
  const traceCells = buildTraceCells(state, mode);
  const breakdown = state.inspector.contextBreakdown;
  const userTurns = moments.reduce(
    (count, moment) => (moment.role === "user" ? count + 1 : count),
    0,
  );
  const cache = useCacheView(breakdown, userTurns);

  const frameRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const traceInnerRef = useRef<HTMLDivElement>(null);

  // gutter / candlestick
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
  // The tool whose I/O the static inspect window shows: hover wins, else the focal tool.
  // Changes only at tool boundaries / hover edges, so the setState is coarse, not per-frame.
  const focalToolRef = useRef<string | null>(null);
  const [inspectKey, setInspectKey] = useState<string | null>(null);
  const turnRef = useRef<number | undefined>(initialTurn);
  // Read by the controller's initial snap only; kept off the effect deps so the debounced turn→URL
  // write (which updates the `initialTurn` prop) never re-runs/re-measures the controller mid-scroll.
  const initialTurnRef = useRef(initialTurn);
  initialTurnRef.current = initialTurn;
  const tailFollowRef = useRef<TailFollowState>(initialTurn ? "detached" : "following");
  const scrollTopRef = useRef(0);
  const initialScrollRef = useRef({ key: "", done: false });
  // assistant-ui mounts the moment sections a tick after we render (and again on edits),
  // without re-rendering the Lens — so the scroll controller's geometry would never see
  // them. The register callback bumps this to force a Lens re-render, which re-runs the
  // controller effect and its synchronous measure(). State+effect, NOT rAF: rAF is paused
  // for background tabs, so an rAF-only re-measure can silently never fire.
  const [, bumpMeasure] = useReducer((tick: number) => tick + 1, 0);
  const bumpPending = useRef(false);
  const initialScrollKey = scrollKey;
  if (initialScrollRef.current.key !== initialScrollKey) {
    initialScrollRef.current = { key: initialScrollKey, done: false };
    turnRef.current = initialTurn;
    tailFollowRef.current = initialTurn ? "detached" : "following";
    scrollTopRef.current = 0;
  }

  // The --vp aperture height feeds the sticky gutter/lane heights. Kept as its own effect so
  // it fires from first paint even on the empty-state tree.
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
  }, [moments, traceCells, mode, onTurnChange, sideOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // The scroller must always mount so the --vp ResizeObserver fires (it feeds the sticky
  // gutter/lane heights). Bailing to a different tree when empty left --vp unset, so on the
  // first populated render the lanes/MapDial fell back to 560px and got cut off.
  return (
    <div className="lens-frame" ref={frameRef} data-mode={mode}>
      <div className="lens-scroller" ref={scrollerRef}>
        {/* The grid (and thus the sidebar) always mounts — even with no messages — so the thread
            list stays visible on a fresh session and the --vp ResizeObserver always fires. */}
        <div className="lens-grid">
          <div className="mapdial" onPointerDown={onPointerDown} aria-label="Timeline">
            <div className="mapdial-strip" ref={stripRef}>
              {moments.map((moment, index) => (
                <div
                  key={moment.id}
                  data-key={moment.id}
                  className={`mapdial-band ${moment.role}${
                    cache.changed.size > 0 && index === moments.length - 1 ? " delta" : ""
                  }`}
                  ref={(el) => {
                    if (el) bandRefs.current.set(moment.id, el);
                    else bandRefs.current.delete(moment.id);
                  }}
                >
                  <span className="num" title={formatTime(moment.createdAt)}>
                    #{moment.turn}
                  </span>
                </div>
              ))}
            </div>
            <div className="cs-wick" ref={wickRef} />
            <div className="cs-cap" ref={capTopRef} />
            <div className="cs-cap" ref={capBotRef} />
            <div className="cs-focal" ref={csFocalRef} />
            <div className="caret" ref={caretRef} />
          </div>

          {/* display:contents so the Root box vanishes from layout — `.lens-chat` stays the
                grid item AND keeps our own ref (asChild would consume it, breaking re-measure). */}
          <ThreadPrimitive.Root style={{ display: "contents" }}>
            <div className="lens-chat" ref={chatRef}>
              {moments.length === 0 ? (
                <div className="grid min-h-[60vh] place-content-center justify-items-center gap-1.5 px-6 text-center text-muted-foreground">
                  <h1 className="m-0 font-[var(--font-display)] text-[30px] font-semibold text-[var(--pe-blue)]">
                    Pea
                  </h1>
                  <p>Ask anything to begin. Pick a thread on the left, or start a new one.</p>
                </div>
              ) : null}
              <ContextStrip state={state} depth={modeDepth(mode)} />
              <Moments register={registerMoment} />
              <RouteChatPluginDock />
            </div>
          </ThreadPrimitive.Root>

          {/* The always-on side lane, now the shared SidePane primitive: it owns width, the drag
              edge, collapse-to-rail, and width persistence ("pe.sideWidth"). The mode dial rides
              the SidePane header (its 40px height == HEAD_H, so the fisheye axis math is intact).
              Geometry the fisheye depends on — grid-column 1, sticky top, --vp height, the trace
              frame — is reapplied via the className + the mode-switched body below. */}
          <SidePane
            side="left"
            storageKey="pe.sideWidth"
            minWidth={240}
            defaultWidth={300}
            open={sideOpen}
            onOpenChange={onSideOpenChange}
            onWidthChange={onSideResize}
            header={sideHead}
            className="lens-side-pane col-start-1 sticky top-0 border-r-[0.5px] bg-[var(--paper-3)]"
          >
            {mode === "trace" ? (
              <div className="lens-trace-frame">
                <div className="lens-pin" ref={traceInnerRef}>
                  {traceCells.map((cell) => (
                    <TraceCellView
                      key={cell.key}
                      cell={cell}
                      registerRef={(el) => {
                        if (el) cardRefs.current.set(cell.key, el);
                        else cardRefs.current.delete(cell.key);
                      }}
                    />
                  ))}
                </div>
                {/* Static inspect window: the focal (or hovered) tool's full I/O, pinned up top —
                    inspection is chronological, so "current tool's data" belongs at a fixed spot
                    while the row list below shows what's coming. */}
                {(() => {
                  const cell = traceCells.find((c) => c.key === inspectKey);
                  return cell ? (
                    <div className="lens-inspect">
                      <TraceCellBody cell={cell} />
                    </div>
                  ) : null;
                })()}
              </div>
            ) : mode === "world" ? (
              <WorldLane breakdown={breakdown} cache={cache} sendNumber={userTurns} />
            ) : (
              threadList
            )}
          </SidePane>
        </div>
      </div>
      {moments.length > 0 ? <div className="lens-scrim" aria-hidden="true" /> : null}
    </div>
  );
}

function ContextStrip({ state, depth }: { state: WorkbenchState; depth: "read" | "trace" }) {
  const [open, setOpen] = useState(false);
  const plan = state.plans.entries;
  const systemPrompt = state.inspector.systemPrompt;
  const showContext = depth !== "read";

  // The context-window breakdown moved to the World lane (single home). This strip keeps the
  // plan, the resolved system prompt, and injected-context entries.
  if (
    plan.length === 0 &&
    !(showContext && (systemPrompt || state.inspector.contextEntries.length))
  ) {
    return null;
  }

  return (
    <div className="mt-[14px] mr-6 ml-[34px] grid gap-2">
      {plan.length > 0 ? (
        <div className={BLOCK}>
          <div className={BLOCK_HEAD}>Plan</div>
          {plan.map((entry) => (
            <div
              className={`${PLAN_ITEM} ${
                entry.status === "completed"
                  ? "text-[var(--slate)]"
                  : entry.status === "pending"
                    ? "text-muted-foreground"
                    : ""
              }`}
              key={entry.id}
            >
              <span
                className={
                  entry.status === "completed"
                    ? "text-[var(--pe-green)]"
                    : entry.status === "in_progress"
                      ? "text-[var(--pe-blue)]"
                      : "text-[var(--kiln)]"
                }
              >
                {entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "▸" : "○"}
              </span>
              <span>{entry.content}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showContext && systemPrompt ? (
        <div className={BLOCK}>
          <button
            className={`${BLOCK_HEAD} w-full cursor-pointer border-0`}
            type="button"
            onClick={() => setOpen((value) => !value)}
          >
            <span>System prompt{systemPrompt.source ? ` · ${systemPrompt.source}` : ""}</span>
            <span className="text-[var(--pe-blue)]">{open ? "hide" : "show"}</span>
          </button>
          {open ? (
            <pre className="m-0 px-[9px] py-2 font-mono text-[11.5px] leading-[1.5] break-words whitespace-pre-wrap text-[var(--lens-ink-2)]">
              {systemPrompt.content}
            </pre>
          ) : null}
        </div>
      ) : null}

      {showContext && state.inspector.contextEntries.length > 0 ? (
        <div className={BLOCK}>
          <div className={BLOCK_HEAD}>Context injected</div>
          {state.inspector.contextEntries.map((entry) => (
            <div className={`${PLAN_ITEM} text-[var(--slate)]`} key={entry.id}>
              <span className="rounded border-[0.5px] border-[rgba(0,86,149,0.4)] px-1.5 py-px text-[10px] tracking-[0.08em] text-[var(--pe-blue)]">
                CTX
              </span>
              <span>{entry.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Shared ContextStrip chrome: bordered block, uppercase block head, plan/context row.
const BLOCK = "overflow-hidden rounded-lg border-[0.5px] border-[var(--line)]";
const BLOCK_HEAD =
  "flex items-center justify-between border-b-[0.5px] border-[var(--line)] bg-[var(--paper-2)] px-3 py-[7px] text-[10px] tracking-[0.12em] uppercase text-[var(--slate)]";
const PLAN_ITEM =
  "flex gap-[9px] border-b-[0.5px] border-[var(--line-soft)] px-3 py-1.5 text-[13px] last:border-b-0";

/** Trace-lane row: header strip ONLY (fixed height). Bodies render in the inspect window. */
function TraceCellView({
  cell,
  registerRef,
}: {
  cell: TraceCell;
  registerRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div data-key={cell.key} className="lens-cell" ref={registerRef}>
      <CellHeader cell={cell} />
    </div>
  );
}

function CellHeader({ cell }: { cell: TraceCell }) {
  if (cell.kind === "tool" && cell.toolCall) {
    const call = cell.toolCall;
    const duration = toolDuration(call);
    return (
      <div className="h">
        <span className="h-title">{call.title}</span>
        {call.status || duration ? (
          <span className="h-meta">
            {call.status ? (
              <span className="tele-label" style={{ color: statusColor(call.status) }}>
                {call.status.replace("_", " ")}
              </span>
            ) : null}
            {duration ? <span className="tele">{duration}</span> : null}
          </span>
        ) : null}
      </div>
    );
  }
  if (cell.kind === "memory" && cell.memory) {
    const entry = cell.memory;
    return (
      <div className="h">
        <span className="h-title">{entry.kind}</span>
        {entry.status ? (
          <span className="h-meta">
            <span className="tele-label">{entry.status}</span>
          </span>
        ) : null}
      </div>
    );
  }
  return null;
}

/** Inspect-window body: full prettified I/O for the focal/hovered cell. */
function TraceCellBody({ cell }: { cell: TraceCell }) {
  if (cell.kind === "tool" && cell.toolCall) {
    return <ToolCellBody call={cell.toolCall} />;
  }
  if (cell.kind === "memory" && cell.memory) {
    const entry = cell.memory;
    return (
      <>
        <CellHeader cell={cell} />
        <pre>{stringify(entry.raw ?? entry.summary ?? entry.title ?? entry.id)}</pre>
      </>
    );
  }
  return null;
}

/** Tool inspect body. Raw I/O is read via useToolIo (already reduced onto the call). */
function ToolCellBody({ call }: { call: WorkbenchToolCall }) {
  const io = useToolIo(call);
  const input = io?.rawInput ?? call.rawInput;
  const output = io?.rawOutput ?? call.rawOutput ?? call.content;
  const error = io?.error ?? call.error;
  const images = toolImages(output);
  return (
    <>
      <CellHeader cell={{ key: `tool:${call.id}`, kind: "tool", toolCall: call }} />
      {input !== undefined ? (
        <>
          <div className="io-label tele-label">in</div>
          <pre>{stringify(input)}</pre>
        </>
      ) : null}
      {images.length > 0 ? (
        images.map((src, index) => <img key={index} className="tool-img" src={src} alt="" />)
      ) : output !== undefined ? (
        <>
          <div className="io-label tele-label">out</div>
          <pre>{stringify(output)}</pre>
        </>
      ) : null}
      {error ? <pre className="io-error">{error}</pre> : null}
    </>
  );
}

/**
 * Render-ready image URLs found in a tool output — no per-tool special-casing. A tool renders
 * inline (instead of dumping base64 into a <pre>) if its output carries image bytes in any of the
 * shapes the model itself gets: a `{ data, mediaType }` result, a media/image content part, or a
 * data: URL. Same normalizer as chat message parts, so the contract is one place. Shallow by design
 * (result object OR its content array) — that's the only shape tools emit; deep-scanning arbitrary
 * output risks walking huge base64 strings for nothing.
 */
function toolImages(output: unknown): string[] {
  const parts = Array.isArray(output) ? output : [output];
  return parts.flatMap((part) => {
    if (typeof part === "string") return part.startsWith("data:image/") ? [part] : [];
    if (part === null || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    const mime = (record.mediaType ?? record.mimeType) as string | undefined;
    if (mime && !mime.startsWith("image/")) return [];
    const direct = (record.image ?? record.url) as string | undefined;
    const data = typeof record.data === "string" ? record.data : undefined;
    const url = imageSource(direct, data, mime);
    return url && (mime?.startsWith("image/") || url.startsWith("data:image/")) ? [url] : [];
  });
}

/**
 * Chat moments derived from the shared `ThreadMessageLike[]` — the SAME array the runtime
 * renders, so the MapDial bands (here) and the assistant-ui moments stay in lockstep.
 */
function toMoments(messages: ThreadMessageLike[]): Moment[] {
  let turn = 0;
  return messages.map((message, index) => {
    if (message.role === "user") turn += 1;
    return {
      id: message.id ?? `m:${index}`,
      turn: Math.max(1, turn),
      role: message.role,
      createdAt: message.createdAt,
    };
  });
}

/** Trace-lane cards: every tool call, plus timeline memory entries in trace depth. */
function buildTraceCells(state: WorkbenchState, mode: Mode): TraceCell[] {
  const lastAssistantId = [...state.transcript.messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const cells: TraceCell[] = state.tools.calls.map((call) => ({
    key: `tool:${call.id}`,
    kind: "tool",
    toolCall: call,
    parentId: call.parentMessageId ?? call.provenance?.messageId ?? lastAssistantId,
  }));
  if (mode !== "threads") {
    for (const entry of state.memory.entries) {
      if (!isTimelineMemoryEntry(entry)) continue;
      cells.push({ key: `memory:${entry.id}`, kind: "memory", memory: entry });
    }
  }
  return cells;
}

function isTimelineMemoryEntry(entry: WorkbenchObservationMemoryEntry): boolean {
  if (entry.status !== "activated") return true;
  const text = `${entry.id} ${entry.title ?? ""} ${entry.summary ?? ""}`.toLowerCase();
  return !(
    text.includes("config") ||
    text.includes("configured") ||
    text.includes("configuration")
  );
}

/* Band numbers show the SEMANTIC exchange turn (Moment.turn — increments per user send), not the
   message index: it's the same coordinate as the URL's ?turn= and the transcript's turn tags, and
   it stays stable while an assistant reply streams as several messages. */

function formatTime(date?: Date): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Telemetry metadata for a tool trace row: status hue + a human duration. Both feed the hybrid
// header's right-aligned `tele` cluster (the machine-measured tier).
const TOOL_STATUS_COLOR: Record<string, string> = {
  completed: "var(--pe-green)",
  failed: "var(--fail)",
  in_progress: "var(--pe-blue)",
  pending: "var(--muted-foreground)",
};

function statusColor(status: string): string {
  return TOOL_STATUS_COLOR[status] ?? "var(--muted-foreground)";
}

function toolDuration(call: WorkbenchToolCall): string | undefined {
  const start = call.startedAt;
  const end = call.completedAt ?? call.updatedAt;
  if (!start || !end) return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable value]";
  }
}
