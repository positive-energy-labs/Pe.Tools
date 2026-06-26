import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type {
  WorkbenchObservationMemoryEntry,
  WorkbenchState,
  WorkbenchToolCall,
} from "@pe/agent-contracts";
import { ThreadPrimitive, type ThreadMessageLike } from "@assistant-ui/react";
import { modeDepth, type Mode } from "./depth.ts";
import { Moments, useThreadMessages } from "./aui.tsx";
import { ContextGutter, useCacheView, WorldLane } from "./world.tsx";
import { useToolIo } from "./tool-io.ts";

/**
 * The unified workbench view (one layout, one scroll). Modes toggle panes over a single
 * parallax layout: `chat` shows chat + MapDial; `trace` adds the detail lane. The MapDial
 * gutter and candlestick focal marker are always present.
 *
 * Provenance across lanes is shown by the focal point + the fisheye, NOT by wires: the
 * message on the focal axis highlights, and its trace card expands in place. The chat
 * column is rendered by assistant-ui (text/reasoning/tool parts via `MessagePrimitive.Parts`),
 * but the LAYOUT — sticky MapDial, fisheye trace lane, single rAF scroll controller — stays
 * ours. assistant-ui renders each message inside a `.lens-moment` section we own (ref +
 * data-key), so the geometry controller measures it exactly as before. Moments are
 * message-granular; tools are parts of their assistant message inline AND cards in the
 * trace lane (linked to the focal message by parentMessageId).
 */

const SCALE = 0.14; // chat px -> map px. Fixed, NOT fit-to-container: long threads overflow, short leave the gutter empty.
const FOCAL = 0.6; // focal line, fraction down the gutter/viewport. Lower than center: history lives above the latest turn.
const MIN_BAND = 3; // px floor so a one-line turn stays visible and clickable.

interface Geom {
  key: string;
  top: number;
  height: number;
}

interface Moment {
  id: string;
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
  onOpenWorld,
}: {
  state: WorkbenchState;
  mode: Mode;
  onOpenWorld?: () => void;
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
  // assistant-ui mounts the moment sections a tick after we render (and again on edits),
  // without re-rendering the Lens — so the scroll controller's geometry would never see
  // them. The register callback bumps this to force a Lens re-render, which re-runs the
  // controller effect and its synchronous measure(). State+effect, NOT rAF: rAF is paused
  // for background tabs, so an rAF-only re-measure can silently never fire.
  const [, bumpMeasure] = useReducer((tick: number) => tick + 1, 0);
  const bumpPending = useRef(false);

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

  const count = moments.length;
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [count]);

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
    // Hover link: a chat message highlights its first tool card.
    const cardByParent = new Map<string, string>();
    for (const cell of traceCells) {
      if (cell.parentId && !cardByParent.has(cell.parentId)) {
        cardByParent.set(cell.parentId, cell.key);
      }
    }

    let geom: Geom[] = [];
    let cards: { key: string; el: HTMLElement }[] = [];
    // Each tool card is anchored to its inline marker's real doc-y in the chat (measured below).
    // The focal card is the one whose anchor is nearest the focal axis — so scrolling walks the
    // focal card to whatever tool is actually at the axis, one at a time, not the whole group.
    let cardAnchors: { key: string; parent: string; anchor: number }[] = [];

    // Fisheye: non-focal cards collapse to their header strip; the SINGLE focal card expands.
    // The lane translates so that card's center sits on the focal axis. A short rAF pump
    // re-measures live during the max-height CSS transition so the translation tracks smoothly.
    let fisheyeKey: string | null = null;
    let fisheyeRaf = 0;
    const positionFisheye = (V: number, focalCardKey: string | null) => {
      const fy = FOCAL * V;
      const hoverKey = hoverKeyRef.current;
      let focalCell: HTMLElement | null = null;
      for (const c of cards) {
        const on = c.key === focalCardKey;
        c.el.style.maxHeight = on ? "400px" : "28px";
        c.el.classList.toggle("focal", on);
        c.el.classList.toggle("hover", c.key === hoverKey && !on);
        if (on) focalCell = c.el;
      }
      const inner = traceInnerRef.current;
      const doLayout = () => {
        if (!inner) return;
        const center = focalCell ? focalCell.offsetTop + focalCell.offsetHeight / 2 : 0;
        inner.style.transform = `translateY(${fy - center}px)`;
      };
      doLayout();
      if (focalCardKey !== fisheyeKey) {
        fisheyeKey = focalCardKey;
        cancelAnimationFrame(fisheyeRaf);
        const end = performance.now() + 300;
        const pump = () => {
          doLayout();
          fisheyeRaf = performance.now() < end ? requestAnimationFrame(pump) : 0;
        };
        fisheyeRaf = requestAnimationFrame(pump);
      }
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

      // The focal card = the card in the focal message's group whose anchor is nearest the
      // focal axis. Scrolling within a long group advances it one tool at a time.
      let focalCardKey: string | null = null;
      let bestDistance = Infinity;
      for (const card of cardAnchors) {
        if (card.parent !== fk) continue;
        const distance = Math.abs(card.anchor - focalDoc);
        if (distance < bestDistance) {
          bestDistance = distance;
          focalCardKey = card.key;
        }
      }
      positionFisheye(V, focalCardKey);
    };

    const measure = () => {
      geom = moments.flatMap((moment) => {
        const el = momentRefs.current.get(moment.id);
        return el ? [{ key: moment.id, top: el.offsetTop, height: el.offsetHeight }] : [];
      });
      geomRef.current = geom;
      // Anchor each tool card to its inline marker's real doc-y in the chat scroll space, so the
      // focal-card pick matches the tool the user sees at the focal axis. `parent` is the
      // enclosing message id, so the focal-message filter in sync() stays consistent.
      cardAnchors = [];
      const chat = chatRef.current;
      if (chat) {
        const scrollerTop = scroller.getBoundingClientRect().top;
        for (const marker of chat.querySelectorAll<HTMLElement>("[data-tool-id]")) {
          const toolId = marker.dataset.toolId;
          const parent = marker.closest<HTMLElement>(".lens-moment")?.dataset.key;
          if (!toolId || !parent) continue;
          const anchor = marker.getBoundingClientRect().top - scrollerTop + scroller.scrollTop;
          cardAnchors.push({ key: `tool:${toolId}`, parent, anchor });
        }
      }
      cards = traceCells.flatMap((cell) => {
        const el = cardRefs.current.get(cell.key);
        return el ? [{ key: cell.key, el }] : [];
      });
      // Re-flow the de-overlap whenever a card's height changes (e.g. expand-in-place).
      cardRo.disconnect();
      for (const card of cards) cardRo.observe(card.el);
      for (const g of geom) {
        const band = bandRefs.current.get(g.key);
        if (!band) continue;
        band.style.top = `${g.top * SCALE}px`;
        band.style.height = `${Math.max(MIN_BAND, g.height * SCALE)}px`;
      }
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
    const cardRo = new ResizeObserver(() => schedule());

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    const onScroll = () => schedule();
    scroller.addEventListener("scroll", onScroll, { passive: true });

    const chat = chatRef.current;
    const trace = traceInnerRef.current;
    // Hovering a chat message highlights its first tool card; trace cells highlight directly.
    const onChatOver = (e: Event) => {
      const id = keyFrom(e, ".lens-moment");
      setHover(id ? cardByParent.get(id) : undefined);
    };
    const onChatLeave = () => setHover(null);
    const onTraceOver = (e: Event) => setHover(keyFrom(e, ".lens-cell"));
    chat?.addEventListener("mouseover", onChatOver);
    chat?.addEventListener("mouseleave", onChatLeave);
    trace?.addEventListener("mouseover", onTraceOver);
    trace?.addEventListener("mouseleave", onChatLeave);

    return () => {
      ro.disconnect();
      cardRo.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      cancelAnimationFrame(fisheyeRaf);
      chat?.removeEventListener("mouseover", onChatOver);
      chat?.removeEventListener("mouseleave", onChatLeave);
      trace?.removeEventListener("mouseover", onTraceOver);
      trace?.removeEventListener("mouseleave", onChatLeave);
    };
    // moments/traceCells are fresh arrays each render; re-running re-measures geometry as the
    // thread (and streaming text heights) change. The register callback re-measures once aui
    // mounts the moment sections. Hover survives via hoverKeyRef.
  }, [moments, traceCells, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // The scroller must always mount so the --vp ResizeObserver fires (it feeds the sticky
  // gutter/lane heights). Bailing to a different tree when empty left --vp unset, so on the
  // first populated render the lanes/MapDial fell back to 560px and got cut off.
  return (
    <div className="lens-frame" ref={frameRef} data-mode={mode}>
      <div className="lens-scroller" ref={scrollerRef}>
        {moments.length === 0 ? (
          <div className="mg-empty">
            <h1>Pea</h1>
            <p>Ask anything to begin. Use the dial to reveal what's happening underneath.</p>
          </div>
        ) : (
          <div className="lens-grid">
            <div className="mapdial" onPointerDown={onPointerDown} aria-label="Timeline">
              <ContextGutter breakdown={breakdown} cache={cache} onOpenWorld={onOpenWorld} />
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
                    <span className="num">{bandNumber(moment, index)}</span>
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
                <ContextStrip state={state} depth={modeDepth(mode)} />
                <Moments register={registerMoment} />
              </div>
            </ThreadPrimitive.Root>

            {mode === "trace" ? (
              <div className="lens-lane trace">
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
              </div>
            ) : mode === "world" ? (
              <div className="lens-lane world">
                <WorldLane breakdown={breakdown} cache={cache} sendNumber={userTurns} />
              </div>
            ) : null}
          </div>
        )}
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
    <div className="mg-context">
      {plan.length > 0 ? (
        <div className="mg-block">
          <div className="mg-block-head">Plan</div>
          {plan.map((entry) => (
            <div
              className={`mg-plan-item ${entry.status === "completed" ? "done" : entry.status}`}
              key={entry.id}
            >
              <span
                className={`mg-plan-mark ${entry.status === "completed" ? "done" : entry.status}`}
              >
                {entry.status === "completed" ? "✓" : entry.status === "in_progress" ? "▸" : "○"}
              </span>
              <span>{entry.content}</span>
            </div>
          ))}
        </div>
      ) : null}

      {showContext && systemPrompt ? (
        <div className="mg-block">
          <button
            className="mg-block-head"
            type="button"
            style={{ width: "100%", border: "none", cursor: "pointer" }}
            onClick={() => setOpen((value) => !value)}
          >
            <span>System prompt{systemPrompt.source ? ` · ${systemPrompt.source}` : ""}</span>
            <span style={{ color: "var(--pe-blue)" }}>{open ? "hide" : "show"}</span>
          </button>
          {open ? <pre className="mg-pre">{systemPrompt.content}</pre> : null}
        </div>
      ) : null}

      {showContext && state.inspector.contextEntries.length > 0 ? (
        <div className="mg-block">
          <div className="mg-block-head">Context injected</div>
          {state.inspector.contextEntries.map((entry) => (
            <div className="mg-plan-item" key={entry.id} style={{ color: "var(--slate)" }}>
              <span className="mg-tag ctx">CTX</span>
              <span>{entry.title}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TraceCellView({
  cell,
  registerRef,
}: {
  cell: TraceCell;
  registerRef: (el: HTMLElement | null) => void;
}) {
  return (
    <div data-key={cell.key} className="lens-cell" ref={registerRef}>
      <TraceCellBody cell={cell} />
    </div>
  );
}

function TraceCellBody({ cell }: { cell: TraceCell }) {
  if (cell.kind === "tool" && cell.toolCall) {
    return <ToolCellBody call={cell.toolCall} />;
  }
  if (cell.kind === "memory" && cell.memory) {
    const entry = cell.memory;
    return (
      <>
        <div className="h">
          {entry.kind} · {entry.status}
        </div>
        <pre>{stringify(entry.raw ?? entry.summary ?? entry.title ?? entry.id)}</pre>
      </>
    );
  }
  return null;
}

/** Tool trace card. Raw I/O is fetched on demand (see useToolIo) rather than streamed per frame. */
function ToolCellBody({ call }: { call: WorkbenchToolCall }) {
  const io = useToolIo(call);
  const input = io?.rawInput ?? call.rawInput;
  const output = io?.rawOutput ?? call.rawOutput ?? call.content;
  const error = io?.error ?? call.error;
  return (
    <>
      <div className="h">{call.title}</div>
      {input !== undefined ? <pre>{stringify(input)}</pre> : null}
      {output !== undefined ? <pre>{stringify(output)}</pre> : null}
      {error ? <pre>{error}</pre> : null}
    </>
  );
}

/**
 * Chat moments derived from the shared `ThreadMessageLike[]` — the SAME array the runtime
 * renders, so the MapDial bands (here) and the assistant-ui moments stay in lockstep.
 */
function toMoments(messages: ThreadMessageLike[]): Moment[] {
  return messages.map((message, index) => ({
    id: message.id ?? `m:${index}`,
    role: message.role,
    createdAt: message.createdAt,
  }));
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
  if (mode !== "chat") {
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

function bandNumber(moment: Moment, index: number): string {
  const time = formatTime(moment.createdAt);
  return time ?? `#${index + 1}`;
}

function formatTime(date?: Date): string | undefined {
  if (!date || Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
